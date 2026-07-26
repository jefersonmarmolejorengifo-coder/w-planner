-- Migration 039: submit_sprint_retro — función transaccional para guardar
-- la retrospectiva individual de un miembro (retro + señales de pares).
--
-- PROBLEMA QUE RESUELVE (B-5 ALTO):
--   El endpoint anterior ejecutaba hasta 5 operaciones Supabase independientes
--   (SELECT → UPDATE|INSERT del retro → DELETE de señales → INSERT de señales).
--   Si algo fallaba entre el DELETE y el INSERT, las señales viejas desaparecían
--   y las nuevas no entraban (corrupción silenciosa). Peor: el error del INSERT
--   de señales solo hacía console.warn y el endpoint devolvía 200 de todas formas.
--
-- SOLUCIÓN: todo en una única función PL/pgSQL que Postgres ejecuta como
-- una transacción atómica implícita (BEGIN…COMMIT/ROLLBACK automático).
-- El endpoint reemplaza las 5 operaciones por una sola llamada RPC.
--
-- NOTA SOBRE UNIQUE(period_id, respondent_user_id):
--   La restricción ya existe en sprint_retros desde la migración 020 (línea 64).
--   No se necesita agregarla aquí. Si en tu instancia no estuviera (schema legacy),
--   ejecutar: SELECT period_id, respondent_user_id, COUNT(*) FROM public.sprint_retros
--             GROUP BY 1,2 HAVING COUNT(*) > 1;
--   Si trae filas, hay duplicados históricos — hay que resolverlos manualmente
--   ANTES de agregar la constraint (no borramos datos automáticamente).
--
-- DECISIÓN SECURITY INVOKER vs DEFINER:
--   Usamos SECURITY INVOKER (el default en Postgres). Esto significa que la
--   función se ejecuta con los permisos del usuario que la llama (rol
--   'authenticated' en Supabase), y las políticas RLS de ambas tablas se
--   aplican automáticamente:
--
--   • sprint_retros INSERT: WITH CHECK (respondent_user_id = auth.uid() AND
--     período abierto Y usuario es miembro/owner). Garantiza que nadie escriba
--     en nombre de otro usuario ni en períodos cerrados.
--
--   • sprint_retros UPDATE: USING/WITH CHECK (respondent_user_id = auth.uid()).
--     Solo el propio respondiente puede actualizar su retro.
--
--   • sprint_retro_peer_signals FOR ALL: USING/WITH CHECK que el retro_id
--     pertenece a un sprint_retros cuyo respondent_user_id = auth.uid().
--     Cubre el DELETE y el INSERT de señales.
--
--   Con SECURITY DEFINER habría que replicar esas tres validaciones manualmente,
--   arriesgando omisiones. INVOKER es más seguro porque la fuente de verdad de
--   las reglas de acceso vive en un solo lugar (las RLS), no duplicada.
--
--   El único caso donde DEFINER sería necesario es si las tablas tuvieran RLS
--   restrictiva que impida al usuario leer su propio retro_id para el DELETE
--   de señales. Las RLS actuales permiten todo lo necesario, así que INVOKER
--   es la elección correcta.

BEGIN;

-- ── Función principal ────────────────────────────────────────────────────────
--
-- Parámetros:
--   p_period_id              BIGINT  — id del sprint_retro_periods
--   p_respondent_name        TEXT    — nombre del respondiente (full_name | email | 'Anónimo')
--   p_emoji                  TEXT    — emoji de emoción (set restringido por CHECK de la tabla)
--   p_liked                  TEXT    — qué le gustó (max 2000 chars)
--   p_disliked               TEXT    — qué no le gustó (max 2000 chars)
--   p_peer_strategic         TEXT    — nombre señalado como strategic_contributor (NULL = sin señal)
--   p_peer_could_give_more   TEXT    — nombre señalado como could_give_more (NULL = sin señal)
--   p_peer_had_it_tough      TEXT    — nombre señalado como had_it_tough (NULL = sin señal)
--
-- Retorna: JSONB { retro_id: bigint, signals_count: int }
--
-- Contrato de seguridad:
--   - respondent_user_id siempre es auth.uid() — nunca acepta un id del cliente.
--   - Las RLS validan membresía y período abierto automáticamente (INVOKER).
--   - Si cualquier sentencia falla, Postgres hace ROLLBACK de todo: las señales
--     viejas nunca quedan borradas sin que las nuevas hayan entrado.

CREATE OR REPLACE FUNCTION public.submit_sprint_retro(
  p_period_id            BIGINT,
  p_respondent_name      TEXT,
  p_emoji                TEXT,
  p_liked                TEXT,
  p_disliked             TEXT,
  p_peer_strategic       TEXT DEFAULT NULL,
  p_peer_could_give_more TEXT DEFAULT NULL,
  p_peer_had_it_tough    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID;
  v_retro_id   BIGINT;
  v_signals_n  INT := 0;
BEGIN
  -- El usuario autenticado siempre se resuelve desde el JWT, nunca del cliente.
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  -- ── 1. UPSERT del retro ────────────────────────────────────────────────────
  -- INSERT si no existe; UPDATE si ya existe. La clave de conflicto es
  -- UNIQUE(period_id, respondent_user_id) definida en la migración 020.
  --
  -- respondent_name solo se setea en el INSERT: si el usuario actualizó su
  -- nombre en Supabase Auth después de responder, preservamos el nombre que
  -- usó en la primera respuesta (consistencia histórica). El endpoint ya
  -- resuelve el nombre antes de llamar a esta función y lo pasa como parámetro.
  --
  -- Las RLS validan:
  --   INSERT: respondent_user_id = auth.uid() Y período abierto Y miembro.
  --   UPDATE: respondent_user_id = auth.uid().
  INSERT INTO public.sprint_retros (
    period_id,
    respondent_user_id,
    respondent_name,
    emoji,
    liked,
    disliked
  )
  VALUES (
    p_period_id,
    v_user_id,
    TRIM(p_respondent_name),
    p_emoji,
    TRIM(p_liked),
    TRIM(p_disliked)
  )
  ON CONFLICT (period_id, respondent_user_id) DO UPDATE
    SET emoji    = EXCLUDED.emoji,
        liked    = EXCLUDED.liked,
        disliked = EXCLUDED.disliked
        -- updated_at lo maneja el trigger sprint_retros_updated_at_trg
        -- respondent_name NO se pisa en el UPDATE (intencional, ver comentario arriba)
  RETURNING id INTO v_retro_id;

  -- ── 2. Reemplazo atómico de señales de pares ───────────────────────────────
  -- DELETE + INSERT dentro de la misma transacción: si el INSERT falla (p.ej.
  -- violación de CHECK en signal_type), Postgres hace ROLLBACK de ambas
  -- sentencias Y del UPSERT del retro. Ningún estado corrupto persiste.
  --
  -- La RLS FOR ALL de sprint_retro_peer_signals cubre DELETE e INSERT:
  -- verifica que el retro_id pertenece a un retro cuyo respondent_user_id
  -- es auth.uid() — el usuario solo puede operar sus propias señales.
  DELETE FROM public.sprint_retro_peer_signals
  WHERE retro_id = v_retro_id;

  -- Solo se insertan señales no nulas y no vacías tras trim.
  IF TRIM(COALESCE(p_peer_strategic, '')) <> '' THEN
    INSERT INTO public.sprint_retro_peer_signals (retro_id, signal_type, signaled_name)
    VALUES (v_retro_id, 'strategic_contributor', TRIM(p_peer_strategic));
    v_signals_n := v_signals_n + 1;
  END IF;

  IF TRIM(COALESCE(p_peer_could_give_more, '')) <> '' THEN
    INSERT INTO public.sprint_retro_peer_signals (retro_id, signal_type, signaled_name)
    VALUES (v_retro_id, 'could_give_more', TRIM(p_peer_could_give_more));
    v_signals_n := v_signals_n + 1;
  END IF;

  IF TRIM(COALESCE(p_peer_had_it_tough, '')) <> '' THEN
    INSERT INTO public.sprint_retro_peer_signals (retro_id, signal_type, signaled_name)
    VALUES (v_retro_id, 'had_it_tough', TRIM(p_peer_had_it_tough));
    v_signals_n := v_signals_n + 1;
  END IF;

  -- ── 3. Resultado ───────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'retro_id',      v_retro_id,
    'signals_count', v_signals_n
  );
END;
$$;

-- Seguridad de grants: revocamos a anon (no debe tener acceso) y otorgamos
-- solo a authenticated. El rol service_role hereda todo por diseño de Supabase.
REVOKE ALL ON FUNCTION public.submit_sprint_retro(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM anon;

GRANT EXECUTE ON FUNCTION public.submit_sprint_retro(
  BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

COMMIT;

-- ── Verificación ──────────────────────────────────────────────────────────────
-- Llamar autenticado como un miembro del proyecto con un período abierto:
--
-- SELECT public.submit_sprint_retro(
--   42,               -- p_period_id: id de un sprint_retro_periods abierto
--   'María García',   -- p_respondent_name
--   '😄',             -- p_emoji
--   'Logramos cerrar el sprint a tiempo', -- p_liked
--   'Muchas interrupciones externas',     -- p_disliked
--   'Pedro López',    -- p_peer_strategic (NULL para omitir)
--   NULL,             -- p_peer_could_give_more
--   'Ana Ruiz'        -- p_peer_had_it_tough
-- );
-- Resultado esperado: {"retro_id": <id>, "signals_count": 2}
--
-- Verificar atomicidad: la tabla sprint_retro_peer_signals debe tener exactamente
-- las señales del último llamado (no acumuladas) para ese retro_id.
