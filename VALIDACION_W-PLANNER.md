# Validación integral — Productivity-Plus (w-planner)

> Ola 1 (validación estática) — 5 especialistas del equipo, solo-lectura. Fecha: 2026-06-24.
> Olas pendientes: 2 (SuperAuditor TRIPLE), 3 (pruebas dinámicas en navegador), 4 (hub Soft a tu medida).

## Scorecard por eje

| Eje | Nota | Auditor |
|---|---|---|
| Estructura / arquitectura | 6.5/10 | infra-scalability |
| Optimización / costo | 6.0/10 | infra-scalability |
| Experiencia (UX) | 7.0/10 | ui-ux |
| **Responsive** | **4.5/10** | ui-ux |
| Robustez backend / datos | 6.5/10 | backend-dev |
| Calidad frontend (código) | 6.8/10 | frontend |
| **Seguridad** | **8.4/10 — NO pasa gate 9.5** | security |

## 🔴 CRÍTICOS — requieren decisión de Jefer (PARADA)

| ID | Eje | archivo:línea | Problema | Acción |
|---|---|---|---|---|
| S-001 | Seguridad | `.env.local:3-16` | Secretos de PRODUCCIÓN reales en disco (service-role, MP, Resend, OpenAI, etc.). No están en git, pero se imprimieron en una sesión de chat. | **Rotar TODAS las llaves.** Solo Jefer (acceso a dashboards). |
| B-1 | Backend | `migrations/027:45` | Lógica de degradado de tier: un usuario con `status=pending` (checkout sin pagar) podría no degradarse a free y crear tableros. | Migración 036 de saneamiento. |
| B-2 | Backend | `api/chat-stream.js:144-208` | Race condition de cuota de chat: 2 requests simultáneos queman 2 turnos contando 1. Multiplica costo de tokens. | Increment atómico en Postgres. |
| S-002 | Seguridad | `migrations/016:149` | Grant residual a `anon` en `user_can_use_ia_on_project` (revoca 031). Verificar que 031 se aplicó en prod. | Query de verificación + migración 036 si aplica. |

## 🟠 ALTOS

| ID | Eje | archivo:línea | Problema |
|---|---|---|---|
| B-4 | Backend | `api/mp-webhook.js:251` | Pago recurrente no setea `tier` en el upsert → usuario paga y queda en free. |
| B-5 | Backend | `api/submit-retro.js:63` | DELETE+INSERT no atómico de señales de retro → corrupción silenciosa si falla en medio. |
| B-3 | Backend | `generate-evolution/save-evolution/generate-monthly` | No validan `periodStart < periodEnd` → gasto de tokens + posible sobrescritura de histórico. |
| R-01/R-02 | Frontend | `ProductivityPlus.jsx:1887-1898` | **Menú responsive (cambio reciente):** ResizeObserver con loop latente de reconexión + `tabsNeedWidthRef` stale en primer render estrecho → parpadeo. Fix de alta confianza disponible. |
| RESP-01 | Responsive | `ProductivityPlus.jsx:2018` | Header principal sin colapso: en <480px los 10+ controles (logo, presencia, sesión, PDF, CSV, campana…) explotan en filas solapadas. |
| RESP-02 | Responsive | `GanttTab.jsx:30` | Gantt ancho fijo 660px + resizer solo-mouse → inservible en táctil/<870px. |

## 🟡 MEDIOS / quick-wins de optimización

- O-03/O-05/O-06: `select('*')` y N+1 (key_results) en `useProjectData.js` y task_history → proyectar columnas + embedded select.
- O-08: `manualChunks` para separar supabase-js (196kB) del chunk índice.
- O-07: modelo evolutivo en `claude-opus-4-7` (legacy) → `claude-opus-4-8`.
- A-02/A-05: extraer TeamPulseTab e IntroScreen a lazy.
- U-01/U-02/R-11: `alert()`/`confirm()` nativos (CONSENSO ui-ux + frontend) → Toast no bloqueante.

## Consenso entre auditores (alta confianza)

1. **Menú responsive con bug latente** — flag de ui-ux (Reserva 1) Y frontend (R-01/R-02). Mismo cambio reciente.
2. **Diálogos nativos `alert`/`confirm`** — ui-ux (U-01/U-02) Y frontend (R-11).
3. **Over-fetch / queries pesadas** — infra (O-03/O-04) Y backend (cobertura de datos).

## Cobertura de tests

44 tests, concentrados en `mp-webhook`, `_auth.validation`, `_auth.ratelimit`, `_email.sanitize`. **Huecos:** chat-stream (0 tests, el endpoint más caro), handler completo de mp-webhook, buildProfiles del evolutivo, validación de fechas.
