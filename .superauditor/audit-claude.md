# Auditoría Claude — 87cb0d0..HEAD

## Metadatos
- Auditor: Claude (Anthropic), Auditor A (orquestador)
- Fecha: 2026-06-26
- Modelo: claude-opus-4-8 (el mejor de la línea CLAUDE — sin nota de degradado)
- Proyecto: f:/proyectos/w-planner
- Alcance: los 9 commits de hoy. Esta ronda audita los FIXES de hoy (qué quedó frágil), no re-audita lo ya cerrado.

## Resumen
Los cambios de hoy cierran la mayoría de los hallazgos abiertos de la ronda 2026-06-24: race de cuota de chat (era A32/CRÍTICO), tier en pago recurrente (A36), retro atómico (A37), validación de periodos (A33), responsive header/Gantt (A40/A41/A42), alert/confirm→Toast (A43), lazy + chunks (A26/A27), y durabilidad de comisión al hub (H-048). El criterio de seguridad fue bueno: los RPC nuevos de cuota/outbox se conceden SOLO a `service_role`, y el RPC de retro usa SECURITY INVOKER apoyándose en las RLS existentes en vez de re-implementar autorización. **No hay críticos nuevos.** Quedan hallazgos MEDIO/BAJO: validación de fecha que acepta fechas con formato válido pero inexistentes, gap residual de fail-open en el enqueue del outbox, y un par de cambios de comportamiento sutiles. El único CRÍTICO vigente es el heredado A29/S-001 (secretos en `.env.local`, rotación diferida por decisión del dueño).

## Hallazgos

### Eje 1 — Arquitectura
- **A1 · OK · `vite.config.js`** — `advancedChunks` (vendor-react / vendor-supabase) es la API correcta de Rolldown para Vite 8; el index baja 334→163 kB (gz 100→45.5). Cierra A27. Verificado en build.
- **A2 · OK · `src/features/team/TeamPulseTab.jsx` + lazy** — TeamPulseTab extraído a feature + React.lazy (cierra A26 parcial). IntroScreen se dejó eager con justificación correcta (se muestra en cada carga; lazy agregaría delay en la pantalla inicial).
- **A3 · MEDIO · `api/cron.js:285+`** — el drain del outbox se agrega ANTES de los jobs de reportes en el MISMO handler (`maxDuration=60s`). Con `HUB_DRAIN_LIMIT=5` × timeout hub 8s ≈ 40s peor caso, deja poco margen para un reporte IA (~55s). Si coinciden backlog de outbox + ventana de reporte, el reporte podría cortarse por maxDuration. Recomendación: drain en su propio cron, o límite 3.
- **A4 · BAJO · `src/hooks/useTasks.js:15`** — `useToast()` dentro de un hook de datos acopla la capa de datos a `<ToastProvider>`. Aceptable, pero complica testear `useTasks` aislado.

### Eje 2 — Seguridad
- **S1 · OK · `migrations/036,038,039`** — grants correctos: `project_chat_consume_quota`/`release_quota` y `hub_outbox_claim` revocados de PUBLIC/anon/authenticated, concedidos solo a `service_role`; `submit_sprint_retro` a `authenticated` pero SECURITY INVOKER (RLS de 020 hace el enforcement). `chat_monthly_usage` y `hub_outbox` con RLS on + REVOKE total. Sin escalada de privilegios nueva.
- **S2 · MEDIO · `api/_auth.js:132` (`isDateOnly`)** — el regex `^\d{4}-\d{2}-\d{2}$` acepta fechas con formato válido pero **inexistentes** (`2026-13-45`, `2026-02-30`). `requireDateRange` (B-3) las deja pasar al query/LLM. Impacto bajo (la BD/LLM las rechaza luego) pero contradice el objetivo de B-3 de cortar ANTES de gastar. Fix: validar con `new Date(...)` y verificar que los componentes coincidan.
- **S3 · BAJO (heredado A29/S-001) · `.env.local`** — se agregó `GEMINI_API_KEY` (ya existían service-role, MP, Resend, OpenAI, OpenRouter, Google, DeepSeek). Sigue en `.gitignore` (no entra a git). Riesgo aceptado por el dueño; rotación pendiente. Sin cambio de postura.

### Eje 3 — Pentesting interno (defensivo)
- **P1 · OK · cuota de chat (H-030)** — la reserva atómica (`INSERT .. ON CONFLICT DO UPDATE WHERE used < quota`) cierra el doble-gasto. Un usuario NO puede refundir su cuota (`release_quota` es service_role-only) ni inflar la de un proyecto ajeno (consume se llama con service_role tras validar `ownerOnly`). Bien defendido.
- **P2 · BAJO · `migrations/039` (`submit_sprint_retro`)** — `p_respondent_name` viene del cliente, pero `respondent_user_id = auth.uid()` server-side: lo peor es un display-name arbitrario en el PROPIO retro. No es spoofing de autoría. Cosmético.
- **P3 · BAJO · `api/chat-stream.js` (fallback no atómico)** — si falta `service_role` o la migración 036 (`42883`), el endpoint cae al check NO atómico, reabriendo la race original. En prod (036 aplicada) no aplica; documentarlo como modo degradado para que nadie despliegue el código sin la migración.

### Eje 4 — Conexiones
- **C1 · MEDIO · `api/mp-webhook.js:311+` (outbox enqueue, H-048)** — la durabilidad protege SOLO si el `INSERT` en `hub_outbox` entró. Si Supabase está caído justo al llegar el pago aprobado, el enqueue falla (`enqueued=false`), el envío inmediato se omite, y la comisión se pierde igual (no hay fila que drenar). Mejora real vs antes (cubre "hub caído / Supabase arriba", el caso común), pero el caso "Supabase caído en el cobro" sigue sin red. Fail-open consciente; un reconciliador periódico contra la API de MP cerraría también ese hueco.
- **C2 · BAJO · `migrations/038` (`hub_outbox_claim` FOR UPDATE SKIP LOCKED vía RPC)** — el lock se libera al retornar la RPC, así que el `SKIP LOCKED` aporta poco; el guard real es el `UPDATE ... WHERE status IN ('pending','failed')` por fila + la dedup del hub por `mp_payment_id`. OK para el volumen; el `SKIP LOCKED` da falsa sensación de exclusión fuerte. Sin acción.
- **C3 · BAJO · `api/chat-stream.js` (reserva temprana)** — la cuota se reserva antes de resolver/crear la sesión; si la creación de sesión falla (raro), la reserva queda consumida sin turno (`releaseQuota` no cubre ese path). No peor que antes. Bajo impacto.

### Eje 5 — UX/UI
- **U1 · OK · RESP-01/RESP-02** — validado EN VIVO (smoke test en producción con cuenta hotmail, 375/600/1200 px): header colapsa sin solapamiento (logo→P+, presencia→badge, overflow "⋯"); Gantt fluido con scroll horizontal en móvil y columna fija ~140px. Cumple el objetivo del eje responsive (era 4.5/10). Cierra A40/A41/A42.
- **U2 · OK · `src/ui/Toast.jsx` + `ConfirmDialog.jsx`** — reemplazo de los 18 `alert`/`confirm` por componentes accesibles (reusa `useDialog`: foco/Esc/trampa, `aria-live`, botón danger). Cierra A43. El `eslint-disable react-refresh/only-export-components` en los providers es el patrón aceptado del repo.
- **U3 · BAJO · `IntroScreen`** — se mostrará en CADA visita (`showIntro` arranca `true`, sin flag de "ya visto"). Fuera del alcance de hoy, pero candidato a persistir un flag en localStorage para no fatigar a usuarios recurrentes.

## Notas para el orquestador
- Auditor A corrió en Opus 4.8 (mejor modelo, sin degradado).
- **Gemini (C) corre por API directa**, NO por agy (la TUI no autentica en este host). El modelo tope `gemini-3.1-pro-preview` NO está en el free-tier de la API key (limit 0); se cae al mejor modelo free disponible (gemini-2.5-pro/flash). El contraste de tercera familia se mantiene, con la salvedad de modelo de menor capacidad que el ideal.
- Sin críticos nuevos. Los más accionables: S2 (validación de fecha real) y C1 (gap de enqueue del outbox).
