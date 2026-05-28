-- Migration 011: campo `show_in_presentation` en task_field_defs para Fase 1.
--
-- La pestaña "Presentación Sprint" muestra una vista pesada por participante
-- con una tarjeta resumen al hover. Cada custom field debe decidir si forma
-- parte de ese resumen — por defecto NO, para que la tarjeta no se sature.
-- El owner del proyecto activa el toggle en Configuración → Campos personalizados.
--
-- Idempotente: el ADD COLUMN IF NOT EXISTS de Postgres no falla si ya existe.

BEGIN;

ALTER TABLE public.task_field_defs
  ADD COLUMN IF NOT EXISTS show_in_presentation BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.task_field_defs.show_in_presentation IS
  'Si true, este campo aparece en la tarjeta resumen de la pestaña Presentación.';

COMMIT;

-- ── Verificación ───────────────────────────────────────────
-- SELECT key, label, show_in_presentation
-- FROM public.task_field_defs
-- WHERE project_id = 27
-- ORDER BY position;
