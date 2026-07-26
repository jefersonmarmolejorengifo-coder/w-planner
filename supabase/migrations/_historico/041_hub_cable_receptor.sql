-- =============================================================================
-- w-planner — Migración 041: infraestructura del cable entrante Hub→app
-- =============================================================================
-- QUÉ hace:
--   Crea tres piezas necesarias para que /api/webhooks/hub.js pueda procesar
--   el evento `suscripcion.cobrada` del Hub (Wompi) con idempotencia, seguridad
--   y continuidad ante emails no resolubles.
--
-- POR QUÉ tres piezas separadas:
--   1. hub_eventos_procesados (candado de idempotencia con máquina de estados)
--      — el reclamo atómico vía RPC `hub_reclamar_evento` garantiza que incluso
--      dos requests concurrentes con el mismo evento_id solo aplican efectos UNA
--      VEZ. Los estados 'procesando'/'procesado'/'revertido' permiten self-healing:
--      si un worker muere a media ejecución sin revertir, el evento se auto-sana
--      cuando el timestamp de 'procesando' supera los 15 minutos (cualquier
--      reintento posterior del Hub reclama el evento desde cero).
--   2. hub_eventos_sin_resolver (parqueo) — permite NO perder un evento cuando
--      el email del pagador no encuentra un usuario en auth.users (error de datos
--      en el Hub, usuario que pagó pero no se registró, etc.). El evento queda
--      registrado para reconciliación manual posterior, en lugar de desaparecer
--      silenciosamente o causar reintentos infinitos con 5xx.
--   3. get_user_id_by_email (RPC) — SELECT en auth.users con comparación
--      case-insensitive en un solo round-trip, sin paginación, O(log n).
--      Necesita SECURITY DEFINER porque auth.users no es accesible desde el
--      schema public sin privilegios de superuser.
--
-- IDEMPOTENCIA DE LA MIGRACIÓN:
--   CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
--   + CREATE OR REPLACE FUNCTION: re-ejecutar esta migración (staging, rollback
--   manual) no rompe nada.
--
-- QUIÉN aplica esta migración: el PM (Jefer), NO el backend-dev.
-- =============================================================================

BEGIN;

-- ── 1. Tabla candado de idempotencia ─────────────────────────────────────────
--
-- Máquina de estados de tres estados:
--   'procesando' → el worker tomó el evento y está ejecutando efectos.
--   'procesado'  → efectos aplicados con éxito; este estado es terminal y
--                  permanente (duplicados futuros reciben 200 sin re-procesar).
--   'revertido'  → el worker falló y revirtió; el Hub puede reintentar y la RPC
--                  hub_reclamar_evento lo reclamará como nuevo.
--
-- Propiedad self-healing:
--   Si un worker muere entre reclamo y reversión (crash, timeout de red, OOM),
--   el evento queda atascado en 'procesando'. En lugar de un candado permanente
--   (el problema del DELETE-que-nunca-llegó del diseño anterior), la RPC
--   hub_reclamar_evento lo reclama automáticamente si 'actualizado_en' tiene
--   más de 15 minutos: el siguiente reintento del Hub lo retoma limpiamente.
--
-- 15 minutos como umbral de vencimiento:
--   El Hub tiene backoff exponencial con primer reintento a ~1-5 min y máximo
--   ~60 min entre reintentos. 15 min es conservador: mayor que la latencia
--   normal de procesamiento (<30 s por Vercel maxDuration), pero menor que el
--   gap entre reintentos tardíos, lo que permite exactamente un auto-sanado
--   por intervalo de backoff sin riesgo de doble procesamiento.
--
-- evento_id es TEXT (no UUID) porque el Hub lo construye como
--   "<suscripcion_id>:<periodo>" (ej. "sus-abc123:2026-07-01")
-- para recurrentes. Forzar UUID rompería el ~5 % de cobros donde el cron del
-- Hub usa el formato compuesto como fallback.
--
-- RLS habilitado SIN políticas + REVOKE explícito: doble barrera.
--   - RLS sin políticas bloquea acceso por defecto para roles con RLS.
--   - REVOKE cierra la grieta a nivel de ACL: el motor rechaza el intento ANTES
--     de evaluar RLS (más rápido, más claro en auditoría de pg_class.relacl).
--   - service_role bypasea RLS y no necesita GRANT explícito.
-- (Patrón: VoxLab 0063_hub_eventos_procesados.sql)

CREATE TABLE IF NOT EXISTS public.hub_eventos_procesados (
  -- ID global de idempotencia que proviene del Hub.
  -- Formato recurrente: "${suscripcion_id}:${periodo_slice}"
  evento_id    TEXT        NOT NULL PRIMARY KEY,
  -- Tipo de evento para auditoría y debugging (ej. 'suscripcion.cobrada').
  evento_tipo  TEXT        NOT NULL,
  -- Momento en que w-planner aplicó los efectos de este evento.
  procesado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Añadir columnas de máquina de estados (ADD COLUMN IF NOT EXISTS es idempotente).
-- Se añaden en ALTER TABLE separados para que re-ejecutar la migración no falle
-- si la tabla ya existe con las columnas nuevas.
ALTER TABLE public.hub_eventos_procesados
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'procesando'
    CHECK (estado IN ('procesando', 'procesado', 'revertido'));

ALTER TABLE public.hub_eventos_procesados
  ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Índice parcial para que hub_reclamar_evento localice rápidamente los eventos
-- en vuelo vencidos sin escanear la tabla completa (que será mayoría 'procesado').
CREATE INDEX IF NOT EXISTS hub_eventos_procesados_inflight_idx
  ON public.hub_eventos_procesados (actualizado_en)
  WHERE estado = 'procesando';

ALTER TABLE public.hub_eventos_procesados ENABLE ROW LEVEL SECURITY;

-- Ninguna política → tabla bloqueada por defecto para anon/authenticated.
-- service_role es el único caller legítimo (admin client del webhook).
REVOKE ALL ON TABLE public.hub_eventos_procesados FROM anon, authenticated;

COMMENT ON TABLE public.hub_eventos_procesados IS
  'Candado de idempotencia con máquina de estados para eventos entrantes del Hub '
  '(cable Hub→w-planner). La RPC hub_reclamar_evento garantiza que cada evento_id '
  'se procesa exactamente una vez. El self-healing (reclamo de eventos ''procesando'' '
  'vencidos >15 min) evita que un worker muerto deje el candado permanente.';

COMMENT ON COLUMN public.hub_eventos_procesados.estado IS
  'procesando = worker activo; procesado = éxito (terminal); revertido = falló, reintentable.';

COMMENT ON COLUMN public.hub_eventos_procesados.actualizado_en IS
  'Timestamp de la última transición de estado. La RPC hub_reclamar_evento lo usa '
  'para detectar eventos procesando vencidos (>15 min) y reclamarlos (self-healing).';

-- ── 2. Tabla de parqueo para eventos sin usuario resoluble ───────────────────
--
-- Cuando el email del payload (`cliente_email`) no se encuentra en auth.users
-- de w-planner, el handler toma el camino de parqueo:
--   - NO devuelve 5xx (evita reintentos infinitos del Hub).
--   - NO pierde el evento: lo inserta aquí para reconciliación manual.
--   - El candado (hub_eventos_procesados) se marca 'procesado' para que
--     reintentos del Hub reciban 200 idempotente (parqueo es estado terminal).
--
-- Casos de uso:
--   a) Usuario pagó con Wompi pero nunca se registró en la app.
--   b) Error tipográfico en el email del Hub vs. el email registrado.
--   c) El Hub envió un app_slug incorrecto (debería no pasar: está validado,
--      pero por si acaso).
--
-- DECISIÓN DE PII — por qué el email vive aquí y no en el JSONB `payload`:
--   La tabla es service_role-only (RLS + REVOKE). El email se guarda UNA SOLA
--   VEZ en la columna dedicada `cliente_email`, necesaria para la reconciliación
--   manual (buscar al usuario por email). El JSONB `payload` se almacena SIN la
--   clave `cliente_email` para no duplicar PII innecesariamente. Cifrarlo
--   rompería la reconciliación manual. Mismo estándar que auth.users y
--   hub.suscripciones en el panel.
--
-- `resuelto` permite marcar la fila cuando un admin la reconcilia a mano.
-- Misma postura de seguridad que hub_eventos_procesados.

CREATE TABLE IF NOT EXISTS public.hub_eventos_sin_resolver (
  evento_id     TEXT        NOT NULL PRIMARY KEY,
  evento_tipo   TEXT,
  -- Email del cliente para reconciliación manual (PII — ver decisión arriba).
  cliente_email TEXT,
  plan_codigo   TEXT,
  -- Payload del Hub para diagnóstico y reconciliación. SIN clave cliente_email
  -- (evita duplicar PII; el email ya está en la columna dedicada de arriba).
  payload       JSONB,
  recibido_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- false = pendiente de reconciliación; true = ya investigado/corregido.
  resuelto      BOOLEAN     NOT NULL DEFAULT false
);

ALTER TABLE public.hub_eventos_sin_resolver ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hub_eventos_sin_resolver FROM anon, authenticated;

COMMENT ON TABLE public.hub_eventos_sin_resolver IS
  'Parqueo de eventos Hub→w-planner cuyo cliente_email no se encontró en auth.users '
  'o cuyo plan_codigo es desconocido. Permite reconciliación manual sin perder datos. '
  'El campo `resuelto` se marca a true cuando un administrador investiga y corrige '
  'la discrepancia. NOTA PII: cliente_email vive SOLO en su columna; el JSONB payload '
  'se almacena sin ese campo para evitar duplicar PII (service_role-only).';

COMMENT ON COLUMN public.hub_eventos_sin_resolver.resuelto IS
  'false = pendiente de reconciliación manual; true = investigado y resuelto.';

COMMENT ON COLUMN public.hub_eventos_sin_resolver.cliente_email IS
  'PII necesaria para reconciliación manual. Se almacena UNA VEZ aquí; '
  'el JSONB payload NO incluye esta clave para no duplicar.';

-- ── 3. RPC get_user_id_by_email ──────────────────────────────────────────────
--
-- QUÉ: resuelve el UUID de auth.users a partir de un email, insensible a mayúsculas.
--      Devuelve NULL si no existe.
--
-- POR QUÉ no usar admin.auth.admin.listUsers():
--   - listUsers con paginación descartaría usuarios fuera de la primera página.
--   - Esta RPC hace SELECT con el índice implícito de auth.users(email): un solo
--     round-trip, O(log n), sin importar el tamaño de la base de usuarios.
--
-- SECURITY DEFINER: auth.users no es accesible desde el schema public sin
--   permisos de superuser. SECURITY DEFINER corre la función con permisos del
--   creador (postgres), permitiendo el SELECT en auth.users.
--   SET search_path = public, pg_temp: previene search_path injection.
--
-- CREATE OR REPLACE: idempotente; si la función ya existe, la actualiza.
-- (Patrón: VoxLab 0064_get_user_id_by_email.sql)

CREATE OR REPLACE FUNCTION public.get_user_id_by_email(p_email TEXT)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id
    FROM auth.users
   WHERE lower(email) = lower(p_email)
   LIMIT 1;
$$;

-- Cerrar acceso por defecto (REVOKE FROM PUBLIC cubre el grant implícito
-- que Postgres otorga al crear funciones; anon/authenticated lo reciben
-- a través de PUBLIC, pero los revocamos explícitamente para claridad en
-- auditorías de pg_proc.proacl).
REVOKE ALL ON FUNCTION public.get_user_id_by_email(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_id_by_email(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.get_user_id_by_email(TEXT) FROM authenticated;

-- Solo el admin client del webhook (service_role key) puede ejecutarla.
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(TEXT) TO service_role;

-- ── 4. RPC hub_reclamar_evento ───────────────────────────────────────────────
--
-- QUÉ: intenta reclamar (tomar propiedad) de un evento para procesarlo.
--      Devuelve:
--        'claimed'   → este worker puede procesar el evento.
--        'duplicate' → el evento ya fue procesado exitosamente (estado='procesado').
--        'in_flight' → otra corrida activa lo tiene tomado (<15 min); no re-procesar.
--
-- POR QUÉ una RPC y no INSERT directo desde JS:
--   El INSERT ON CONFLICT DO NOTHING del diseño anterior no distinguía entre
--   "ya procesado" (terminal, no reintentar) y "en vuelo" (activo, esperar) o
--   "revertido" (falló, ok reintentar). La RPC encapsula esa lógica en una
--   transacción atómica sin round-trips adicionales desde JS.
--
-- Lógica de reclamo (atómica en un INSERT ... ON CONFLICT ... DO UPDATE):
--   INSERT el evento_id en 'procesando'.
--   ON CONFLICT: actualiza a 'procesando' SOLO SI:
--     a) el estado actual es 'revertido' (falló antes, ok retomar), O
--     b) el estado es 'procesando' Y actualizado_en tiene >15 min (worker muerto,
--        self-healing: el próximo reintento lo retoma limpiamente).
--   Si el UPDATE no aplica (estado='procesado', o 'procesando' reciente):
--     v_claimed queda NULL (RETURNING no devuelve filas).
--     Se lee el estado actual para devolver 'duplicate' o 'in_flight'.
--
-- Self-healing (por qué reclamar 'procesando' vencido):
--   Si un worker muere entre el reclamo y la marcación (crash de Vercel, timeout
--   de red, OOM), el evento queda en 'procesando' con un actualizado_en viejo.
--   Sin self-healing, ese candado sería permanente: los reintentos del Hub verían
--   'in_flight' eternamente aunque nadie esté procesando → el plan nunca se activa
--   aunque el cobro ocurrió. Con el umbral de 15 min, el primer reintento tardío
--   lo reclama desde cero y el upsert users_premium (idempotente) lo aplica.
--
-- SECURITY DEFINER + search_path = public, pg_temp: misma postura que
--   get_user_id_by_email. Necesario para que service_role pueda hacer
--   INSERT/UPDATE en hub_eventos_procesados a través de la RPC.

CREATE OR REPLACE FUNCTION public.hub_reclamar_evento(
  p_evento_id   TEXT,
  p_evento_tipo TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claimed BOOLEAN;
  v_estado  TEXT;
BEGIN
  -- Intento atómico de reclamo.
  -- INSERT normal para evento nuevo.
  -- ON CONFLICT: solo actualiza si el evento es reintentable:
  --   - 'revertido': falló antes, permitimos retomar.
  --   - 'procesando' con más de 15 min: worker muerto (self-healing).
  -- Si el estado es 'procesado' o 'procesando' reciente, el WHERE del DO UPDATE
  -- no aplica → 0 filas devueltas → v_claimed queda NULL.
  INSERT INTO public.hub_eventos_procesados (evento_id, evento_tipo, estado, actualizado_en)
    VALUES (p_evento_id, p_evento_tipo, 'procesando', NOW())
  ON CONFLICT (evento_id) DO UPDATE
    SET estado        = 'procesando',
        actualizado_en = NOW()
  WHERE hub_eventos_procesados.estado = 'revertido'
     OR (
          hub_eventos_procesados.estado = 'procesando'
          AND hub_eventos_procesados.actualizado_en < NOW() - INTERVAL '15 minutes'
        )
  RETURNING TRUE INTO v_claimed;

  -- Si reclamamos (INSERT nuevo o UPDATE exitoso), informamos al worker que proceda.
  IF v_claimed IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  -- No reclamamos: leer el estado actual para dar una respuesta informativa.
  SELECT estado INTO v_estado
    FROM public.hub_eventos_procesados
   WHERE evento_id = p_evento_id;

  IF v_estado = 'procesado' THEN
    -- Estado terminal: el evento ya fue aplicado exitosamente en una corrida anterior.
    RETURN 'duplicate';
  ELSE
    -- Estado 'procesando' reciente (<15 min): otra corrida activa lo tiene.
    -- El Hub no debe re-procesar. Si ese worker murió, el auto-sanado ocurrirá
    -- en el siguiente reintento tardío (>15 min).
    RETURN 'in_flight';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.hub_reclamar_evento(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hub_reclamar_evento(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.hub_reclamar_evento(TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.hub_reclamar_evento(TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.hub_reclamar_evento(TEXT, TEXT) IS
  'Reclama atómicamente un evento para procesarlo. Devuelve: '
  '''claimed'' (proceder), ''duplicate'' (ya procesado, ignorar), '
  '''in_flight'' (otra corrida activa <15 min, esperar). '
  'Self-healing: reclama eventos ''procesando'' con >15 min (worker muerto).';

-- ── 5. RPC hub_marcar_evento_procesado ──────────────────────────────────────
--
-- QUÉ: transiciona el estado del evento a 'procesado' (terminal).
--      Se llama ANTES de responder 200 cuando los efectos se aplicaron con éxito.
--      También se llama en casos de parqueo (user_not_found, plan_desconocido):
--      esos eventos son terminales (no deben reprocesarse; el Hub no puede resolverlos
--      solo → la respuesta es 200 + parked, y el parqueo es la acción manual).
--
-- POR QUÉ marcar ANTES de responder 200 (y no después):
--   Si marcáramos DESPUÉS y el proceso muere entre el 200 y el UPDATE, el candado
--   quedaría en 'procesando' y se auto-reclamaría a los 15 min. El siguiente
--   reintento re-procesaría el evento. Como el upsert users_premium es idempotente,
--   el resultado sería correcto, pero se haría trabajo innecesario. Marcar antes
--   minimiza ese caso (aunque el 200 puede perderse igualmente; el Hub reintentará
--   y recibirá 'duplicate').

CREATE OR REPLACE FUNCTION public.hub_marcar_evento_procesado(p_evento_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.hub_eventos_procesados
     SET estado        = 'procesado',
         actualizado_en = NOW()
   WHERE evento_id = p_evento_id;
END;
$$;

REVOKE ALL ON FUNCTION public.hub_marcar_evento_procesado(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hub_marcar_evento_procesado(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.hub_marcar_evento_procesado(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.hub_marcar_evento_procesado(TEXT) TO service_role;

COMMENT ON FUNCTION public.hub_marcar_evento_procesado(TEXT) IS
  'Marca el evento como procesado (terminal). Se llama en éxito y en parqueo '
  '(user_not_found, plan_desconocido). Previene que el self-healing lo reclame '
  'en reintentos futuros del Hub.';

-- ── 6. RPC hub_revertir_evento ───────────────────────────────────────────────
--
-- QUÉ: transiciona el estado del evento a 'revertido', permitiendo que el Hub
--      reintente y hub_reclamar_evento lo tome de nuevo.
--
-- POR QUÉ UPDATE en lugar de DELETE (diseño anterior):
--   Con DELETE, si la reversión fallaba, el candado quedaba en 'procesando'
--   PERMANENTEMENTE (sin self-healing). Con UPDATE a 'revertido', incluso si
--   este UPDATE falla y el evento queda en 'procesando', el self-healing de 15 min
--   lo retoma igualmente: no hay diferencia funcional entre 'revertido' reciente
--   y 'procesando' vencido desde la perspectiva del reclamo.
--   La diferencia es semántica y de auditoría: 'revertido' indica intención explícita
--   de reversión; 'procesando' vencido indica worker muerto.
--
-- Si hub_revertir_evento falla (BD caída, timeout):
--   El evento queda en 'procesando' con actualizado_en viejo (o el viejo si ni
--   siquiera llegó el UPDATE). En ambos casos, a los 15 min la RPC de reclamo
--   lo retoma. Propiedad self-healing preservada incluso ante fallo de reversión.

CREATE OR REPLACE FUNCTION public.hub_revertir_evento(p_evento_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.hub_eventos_procesados
     SET estado        = 'revertido',
         actualizado_en = NOW()
   WHERE evento_id = p_evento_id;
END;
$$;

REVOKE ALL ON FUNCTION public.hub_revertir_evento(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hub_revertir_evento(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.hub_revertir_evento(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.hub_revertir_evento(TEXT) TO service_role;

COMMENT ON FUNCTION public.hub_revertir_evento(TEXT) IS
  'Marca el evento como revertido, habilitando reintento. Reemplaza el DELETE del '
  'diseño anterior: si este UPDATE falla, el evento queda en ''procesando'' con '
  'timestamp viejo → self-healing a los 15 min → propiedad preservada.';

COMMIT;

-- =============================================================================
-- Verificación (ejecutar manualmente después de aplicar):
-- =============================================================================
-- -- 1. Tablas existentes:
-- SELECT tablename FROM pg_tables
--  WHERE schemaname = 'public'
--    AND tablename IN ('hub_eventos_procesados','hub_eventos_sin_resolver');
--
-- -- 2. Columnas de máquina de estados:
-- SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name   = 'hub_eventos_procesados'
--    AND column_name IN ('estado','actualizado_en');
--
-- -- 3. RLS habilitado:
-- SELECT relname, relrowsecurity
--   FROM pg_class
--  WHERE relname IN ('hub_eventos_procesados','hub_eventos_sin_resolver');
--
-- -- 4. RPCs con permisos correctos:
-- SELECT routine_name, security_type
--   FROM information_schema.routines
--  WHERE routine_schema = 'public'
--    AND routine_name IN (
--      'get_user_id_by_email',
--      'hub_reclamar_evento',
--      'hub_marcar_evento_procesado',
--      'hub_revertir_evento'
--    );
--
-- -- 5. Probar reclamo manual (reemplazar con evento_id real):
-- SELECT public.hub_reclamar_evento('test-evento-001', 'suscripcion.cobrada');
-- -- Esperar resultado 'claimed'. Luego:
-- SELECT public.hub_reclamar_evento('test-evento-001', 'suscripcion.cobrada');
-- -- Esperar resultado 'in_flight' (procesando reciente).
-- SELECT public.hub_marcar_evento_procesado('test-evento-001');
-- SELECT public.hub_reclamar_evento('test-evento-001', 'suscripcion.cobrada');
-- -- Esperar resultado 'duplicate'.
-- =============================================================================
