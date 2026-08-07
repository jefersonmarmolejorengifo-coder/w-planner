-- ─────────────────────────────────────────────────────────────────────────────
-- HIGIENE DE PERMISOS — `anon` deja de tener privilegios sobre las tablas.
--
-- POR QUÉ IMPORTA AUNQUE HOY NO HAYA FUGA
--   Esta mañana, ocho policies heredadas `TO public USING (true)` daban a
--   cualquiera con la anon key —que viaja pública en el bundle— lectura y
--   escritura sobre las tareas, participantes, indicadores y correos de todos
--   los tableros. Las policies ya se eliminaron (migración 20260806130000) y se
--   revocó `anon` en esas seis tablas.
--
--   Pero otras 27 tablas conservan `GRANT ALL … TO anon`. Hoy no se filtra nada
--   porque ninguna policy alcanza a `anon` (verificado: cero policies con rol
--   anon o public). El problema es que ese es EXACTAMENTE el estado que permitió
--   la fuga: con el GRANT puesto, basta una sola policy futura mal escrita para
--   reabrir la puerta entera. Sin el GRANT, esa policy no serviría de nada.
--
--   Defensa en profundidad: dos cerrojos que deben fallar a la vez, no uno.
--
-- ES SEGURO
--   La aplicación exige sesión para todo: no hay ninguna consulta a tablas antes
--   de autenticarse (el arranque va getSession → pantalla de acceso). Los
--   endpoints de servidor usan service_role, que no se toca. Y `authenticated`
--   conserva todos sus permisos.
--
-- Se corrige además el ALTER DEFAULT PRIVILEGES que hacía nacer abierta cada
-- tabla y secuencia nuevas, igual que se hizo con las funciones en la
-- migración 20260806210000.
--
-- IDEMPOTENTE: se puede correr varias veces sin efecto.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  v_tabla TEXT;
  v_n     INT := 0;
BEGIN
  FOR v_tabla IN
    SELECT DISTINCT table_name
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee = 'anon'
    ORDER BY table_name
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_tabla);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'privilegios de anon revocados en % tablas', v_n;
END $$;

-- Secuencias: mismo razonamiento. authenticated conserva las suyas.
DO $$
DECLARE
  v_seq TEXT;
  v_n   INT := 0;
BEGIN
  FOR v_seq IN
    SELECT DISTINCT object_name
    FROM information_schema.role_usage_grants
    WHERE object_schema = 'public' AND grantee = 'anon'
    ORDER BY object_name
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon', v_seq);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'privilegios de anon revocados en % secuencias', v_n;
END $$;

-- Que lo nuevo no nazca abierto. Sin esto, la próxima tabla vuelve al estado de
-- partida sin que nadie escriba un GRANT.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

COMMIT;

-- ─── Verificación ────────────────────────────────────────────────────────────
--
-- No debe quedar ninguna fila:
-- SELECT table_name, privilege_type FROM information_schema.role_table_grants
--  WHERE table_schema='public' AND grantee='anon';
--
-- Y el guard completo: scripts/smoke-rls-tenant-isolation.sql
