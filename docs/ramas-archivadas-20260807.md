# Ramas archivadas — 2026-08-07

Se borraron tras verificar **una por una** que su contenido está totalmente
contenido en `main` (`git rev-list --count main..rama` = 0 en todas).

Dos aparentaban trabajo propio y no lo era:

- `feat/reembolso-y-legales`: 3 commits pre-squash del PR #33. Sus páginas
  legales y la revocación por reembolso están en main (verificado por archivo
  y por contenido de `api/webhooks/hub.js`).
- `respaldo/antes-de-integrar-20260726`: respaldo previo a una integración.
  Su única diferencia real con main era **código antiguo ya reemplazado**
  (`shouldSendNow`, el texto "Requiere Enterprise", el `.then(() => {})`…).

Nota: las ~34 ramas `fix/superauditor-sprint-*` que aparecían en el listado
local ya estaban borradas en GitHub; eran referencias de seguimiento muertas
que se limpiaron con `git fetch --prune`.

Para recuperar una: `git checkout -b <nombre> <sha>`. El objeto sigue en el
repositorio local mientras no se recolecte la basura; la remota es
restaurable desde la pestaña de ramas eliminadas de GitHub.

| ámbito | rama | SHA | último commit |
|---|---|---|---|
| local | `claude/eloquent-lederberg` | `4a23946` | fix: repair new task creation ID reservation and sync top-level c |
| local | `feat/portal-cancelacion-hub` | `c4316b7` | feat(suscripcion): botón "Gestionar o cancelar mi plan" al panel |
| local | `feat/reembolso-y-legales` | `55eda43` | fix(seguridad): UPDATE de revocacion atomico contra carrera con r |
| local | `feat/seo-cutover-app-a-app` | `0a296be` | feat(seo): corte de routing — marketing en / y app en /app (req |
| local | `respaldo/antes-de-integrar-20260726` | `322e342` | feat(supabase): línea base del esquema real + endurecer validaci |
| remota | `feat/seo-cutover-app-a-app` | `0a296be` | feat(seo): corte de routing — marketing en / y app en /app (req |
