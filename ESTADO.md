# ESTADO — Productivity-Plus (w-planner)

> Resumen corto del último bloque de trabajo y de lo que falta. Lo mantiene el líder de sesión al cerrar.

**Última actualización:** 2026-09-15

## Qué se hizo (2026-09-14/15)

- **Login por código en vez de link mágico** (`f81fac9`). Causa raíz demostrada con logs: Microsoft 365 Safe Links abría el enlace ~20 s después de llegar el correo y gastaba el token de un solo uso; los usuarios con correo corporativo nunca podían entrar.
- **Plantillas de correo de Supabase Auth con la marca** (6) en `scripts/auth-email/templates.js`, publicadas con `scripts/apply-auth-email-templates.mjs` (14/14 claves verificadas) y probadas con un correo real a la cuenta corporativa: ningún acceso del escáner.
- **Correos propios de la app** (invitación, retro) con la misma identidad sobre `api/_email-brand.js` (`4b7a18f`).
- **Plan Pro Team sin cobro** para `jdmarmolejo@ingeniopichichi.com` (cuenta de Jefer) con `admin_set_user_plan`: activo, sin suscripción ni vencimiento; verificado como lo ve la app.
- **Detector de deriva de plantillas** (H-056, H-058): `--check` sale 1 si producción difiere, `--apply` exige `SUPABASE_PROJECT_REF` explícito, y `scripts/auth-email/published.json` + test de huella en el CI.
- **Aviso de enlace viejo** (H-065) y mensaje honesto cuando se agota el tope de correos (H-062).
- **CAPTCHA (Cloudflare Turnstile) ACTIVO en producción desde 2026-09-15** (H-054): widget "Productivity-Plus login" creado por API, clave pública en Vercel, secreto en Supabase; pedir un código sin CAPTCHA se rechaza (`captcha_failed`) y el tope de correos subió de 30 a 100/h. Comprobado que el login por código y la renovación de sesión siguen funcionando. Si Turnstile no carga, la persona ve qué pasa, puede reintentar y, al segundo fallo, tiene el contacto info@softatumedida.com. Reversión: `SUPABASE_PROJECT_REF=pkccbrzsvcipkmnllxhz node scripts/enable-auth-captcha.mjs --disable`.
- **Pruebas de componente del login** (jsdom + Testing Library, H-053), incluidas las rutas de CAPTCHA y de fallo, con sabotajes que fallan donde deben.
- **"El código llega pero siempre dice vencido" (2026-09-15) → ARREGLADO.**
  - Causa, con logs de Auth: la persona escribía el código de un correo anterior, ya anulado porque cada pedido anula los previos. Los correos tenían el mismo asunto y Outlook los agrupaba en una conversación. Verificaciones `otp_expired` a los 9-16 s de cada envío, con el token vigente sin usar. El servidor está sano (`--check` limpio).
  - Arreglo 1: **el código va al inicio del asunto**, por decisión del dueño (`3eae64e` + `add69eb`, publicado con `--apply`, 14/14 OK, security 9.6). Cada correo queda separado y el último arriba. Costo aceptado: el código se ve en la notificación bloqueada y en paneles que solo muestran el asunto.
  - Arreglo 2: **la pantalla muestra la hora del código vigente** y la usa en el mensaje de error (`0fd8510`, 385 tests, desplegado en Vercel).
- **El dueño que crea un tablero arranca con el tour de PO (2026-09-15) → ARREGLADO.**
  - Causa: `create_project_secure` insertaba al creador sin rol, así que tomaba el DEFAULT `'participant'` y le arrancaba el tour de participante.
  - Base: migración `20260915120000_duenio_nace_po_y_tours_por_rol.sql` (`324b8a9`), ensayada con ROLLBACK, aplicada y verificada. El creador entra como `'po'`, un trigger lo garantiza en cualquier INSERT del dueño y `user_onboarding.completed_roles` guarda qué tours se completaron.
  - App (`896dc1c`): al crear un tablero por cualquiera de los dos caminos arranca el tour de PO, solo la primera vez como dueño (decisión de Jefer).
- **El historial de cambios ya no se cruza entre tarjetas (2026-09-15) → ARREGLADO** (`bf4395b`, 400 tests, desplegado).
  - Causa: el historial vivía en un estado compartido del tablero. Abrir "Nueva tarea" no lo limpiaba, así que mostraba el de la última tarjeta abierta, y una respuesta lenta de una tarjeta anterior podía pisar la actual.
  - Arreglo: hook `src/hooks/useTaskHistory.js`. Limpia al abrir una tarea nueva, descarta respuestas viejas y filtra por tarea **y** tablero. Los campos se muestran en español (`src/lib/taskHistoryLabels.js`).
- **El peso de las super-tareas ya se puede escribir (2026-09-15) → ARREGLADO** (`8200c96` + `0039bb8` + `89091a5`, 450 tests, desplegado).
  - Causa: el campo era un `type="number"` controlado con `Number(w) || 1`. Borrarlo o escribir "0" devolvía 1, así que era imposible teclear "0.5"; solo se podía con las flechitas, y en locale español el navegador mostraba coma.
  - Arreglo: `src/lib/superTaskWeight.js` (parseo y formato puros) + `src/ui/WeightInput.jsx` (campo de texto compartido: acepta punto o coma, selecciona todo al enfocar, ignora teclas inválidas, avisa de forma accesible y revierte al último valor bueno al salir). Lo usan `TaskForm` (TaskSuperLinksEditor) y `SuperTaskCreatorModal`.
  - Rango decidido con el dueño: mayor que 0 y hasta 1, máximo 2 decimales. El `CHECK` de la base sigue en `> 0 AND <= 5`; los 4 enlaces > 1 del tablero demo se ven pero no se pueden reescribir por encima de 1.
  - De paso: el guardado tenía un debounce falso (los timers vivían en una propiedad de una función que se recreaba en cada render, así que cada tecla disparaba su UPDATE); ahora es un `useRef` por super-tarea. Y `SuperTasksTab` mostraba el peso con 1 decimal (0.25 se veía "×0.3").
- **Seis mejoras del tablero pedidas por el dueño (2026-09-15) → EN PRODUCCIÓN** (`f803805`, 513 tests, un solo despliegue).
  - **Super-tareas al crear la tarjeta**: la sección exigía `task.id` y `task_super_links` tiene FK a `tasks`. Ahora la selección y los pesos viven en memoria y `BoardTab.save()` los inserta tras confirmar el id; `createTask` devuelve la tarea creada o `null` (`src/lib/superTaskLinks.js`).
  - **Salir de la tarjeta guarda**: X, clic fuera y Escape guardan; "Cancelar" pasó a "Descartar" con confirmación. El modal ya NO se cierra antes de escribir: si la validación o la escritura fallan, sigue abierto con los datos (`src/lib/hasUnsavedChanges.js`).
  - **Candado anti doble guardado**: cerrar dos veces con el guardado en vuelo reservaba dos ids y creaba DOS tareas (o mostraba un conflicto falso). `savingRef` síncrono + `try/finally` + pie deshabilitado + "Guardando…" y toast "Tarjeta guardada".
  - **OKR en la tarjeta**: el título del resultado clave se ve en el tablero (`src/lib/krTitle.js`), pasado ya resuelto como string para no romper el `memo` de `TaskCard`.
  - **Avance del OKR sin depender de subtareas**: era todo-o-nada (% de tareas Finalizada); ahora es el promedio del avance real, Finalizada cuenta 100 y Cancelada se excluye (`src/lib/okrProgress.js`).
  - **Subtareas reordenables**: asa de arrastre nativo + flechas ▲▼ (24×24 px, el único camino en móvil y el accesible por teclado); cada subtarea gana `uid` estable (`src/lib/reorder.js`).
  - **Arrastrar tarjetas entre columnas**: arrastre nativo sin librería; la regla de `validationClose` al cerrar se extrajo a `src/lib/closeValidation.js` y la comparten formulario y arrastre; `updateTask(..., { skipAporteRecalc: true })` evita que arrastrar reescriba el `aporte_snapshot` histórico y mueva los jarrones de super-tareas. Límite aceptado: el arrastre nativo no responde al dedo ni al teclado.
  - **Dos defectos preexistentes cerrados de paso**: la bitácora de comentarios no guardaba nada (recibía un `projectId` inexistente, botón muerto) y, con dos diálogos abiertos, Escape cerraba los dos de golpe (`useDialog` ahora lleva pila de diálogos, cubierta por `src/useDialog.test.jsx`).
- **Revisión del mismo bug en otros proyectos** (solo lectura, logs de 24 h sin tráfico de acceso en ninguno): Cuadre y VoxLab expuestos (canjean el `token_hash` en el GET), TuAgendaApp (enlace puro), Triada (sin acceso por API); el Hub manda código + enlace de respaldo (el enlace anula el código); hirly ya usa código; Academia aún no está en producción.

## Qué falta

| Pendiente | Depende de | Prioridad |
|---|---|---|
| Prueba final: entrar con jdmarmolejo@ingeniopichichi.com (CAPTCHA + código + plan Pro Team) | Jefer | Alta |
| Vigilar `captcha_failed` en los logs de Auth durante 48 h (si sube, revertir con `enable-auth-captcha --disable`) | — | Media |
| Arreglar el bug de enlaces: Cuadre y VoxLab → TuAgendaApp → Hub (quitar el enlace de respaldo) → hirly (`email_change`) → Triada | Jefer lo dejó para el final (repos aparte; el Hub cruza la frontera de afiliados) | Alta en los que tengan usuarios corporativos |
| Vista global de actividad del tablero (quién cambió qué y en qué tarea), además del historial por tarjeta | Decisión de Jefer | Media |
| Cerrar `user_onboarding` a `anon` (`REVOKE ALL ... FROM anon`); hoy no es explotable porque la RLS lo impide | OK de Jefer (migración con ensayo) | Media |
| La prueba de cooldown de `AuthScreen` falla a veces bajo carga (pasa al repetir) | — | Baja |
| Un fallo al guardar un peso reemplaza TODA la lista de super-tareas por un banner rojo (`TaskForm.jsx`, mismo estado `error` que un fallo de carga); separarlo en aviso junto al campo | — | Media |
| Verificar con un lector de pantalla real que el aviso de peso inválido se anuncia (`role="alert"` sobre texto que no cambia) | — | Baja |
| Unificar el color de borde de `WeightInput` (#ccc) con el del resto de campos (#ddd) | — | Baja |
| El texto del peso no aclara que cada super-tarea tiene el suyo (no se reparte un total entre varias) | — | Media |
| El formulario de creación quedó largo; plegar "Super-tareas que alimenta" en un acordeón solo al crear | — | Baja |
| Título del OKR en la tarjeta: recorte a una línea + `title=` nativo, que en móvil no existe (evaluar 2 líneas) | — | Baja |
| 🎯 se usa a la vez para super-tareas y para OKR; diferenciar íconos | — | Baja |
| Errores crudos de Supabase visibles en la bitácora y en el enlace a super-tareas (preexistente) | — | Baja |
| Reautorizar el conector de Gmail en claude.ai | Jefer | Baja |
| Outlook de escritorio muestra los correos a todo el ancho (Supabase borra los comentarios MSO) | — | Baja, aceptado |

Detalle de hallazgos y prioridades: `AUDIT_PLAN.md` (ronda 2026-09-14).
