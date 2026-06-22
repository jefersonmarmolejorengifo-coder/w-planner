# Auditoría Claude — 1a90dc1..52ca539

## Metadatos
- Auditor: Claude (Anthropic) — Auditor A / orquestador
- Fecha: 2026-06-22
- Modelo: claude-opus-4-8 (el mejor de la línea CLAUDE — calidad máxima)
- Proyecto: C:/Users/jefer/proyectos/w-planner
- Foco solicitado: escalabilidad y concurrencia (muchas personas creando tarjetas a la vez), calidad, uso, UX.

## Resumen
La app es sólida en su funcionalidad y ha endurecido seguridad de pagos/webhooks en rondas previas. El riesgo dominante para "salir a producción con muchos usuarios" NO es de seguridad sino de **escalabilidad por concurrencia**: el mecanismo de reserva de IDs de tarjeta (`claim_task_id`) es un punto de serialización global que empeora con el número de proyectos. A esto se suma la falta total de pruebas automatizadas, un frontend monolítico de ~9.7k líneas, y agregaciones de datos hechas en el cliente sin paginación. Estos son los hallazgos diferenciales de Auditor A; los hallazgos de seguridad de pago/IDOR los aportan con más detalle B (Codex) y C (Gemini).

## Hallazgos

### Eje 1 — Arquitectura / Escalabilidad

### H-A01 | ALTO | Escalabilidad/Concurrencia | `claim_task_id()` serializa la creación de tarjetas a nivel GLOBAL y empeora con cada proyecto

**Evidencia:** `migrations/006_security_hardening.sql:65-92` (función), `src/ProductivityPlus.jsx:1445` (se invoca al ABRIR el formulario de nueva tarjeta), `migrations/002_multiproject.sql:29` (app_config pasó a tener `project_id`, hay un `nextId` por proyecto).

**Descripción:** `claim_task_id()` ejecuta `UPDATE app_config SET value = value+1 WHERE key = 'nextId' RETURNING ... INTO current_value` **sin filtrar por `project_id`**. Como migración 002 creó una fila `nextId` por proyecto, este UPDATE toca **todas** las filas `nextId` de **todos** los proyectos en cada llamada, y devuelve un valor arbitrario. Consecuencias:
1. **Contención cross-tenant:** cada creación de tarjeta en CUALQUIER proyecto toma lock de escritura sobre las filas `nextId` de todos los proyectos. Dos personas creando tarjetas en proyectos distintos igualmente se serializan entre sí.
2. **Empeora con la escala:** el costo de cada `claim_task_id` es O(#proyectos). Cuantos más tableros existan en la plataforma, más lento y más contencioso se vuelve crear una tarjeta.
3. **Se dispara al ABRIR el formulario**, no al guardar (`src/ProductivityPlus.jsx:1445`): cada "nueva tarjeta" que alguien abre (aunque no guarde) ejecuta este write global multi-fila + su broadcast realtime, amplificando la contención y quemando IDs (huecos).

**Impacto:** Es exactamente el escenario que preocupa: "¿muchas personas pueden crear tarjetas a la vez sin bloquearse?". Hoy funciona a baja escala (los locks duran microsegundos y los IDs siguen siendo únicos porque `tasks.id` es PK global), pero bajo concurrencia real y con muchos tableros la creación de tarjetas se vuelve un cuello de botella global, no aislado por proyecto.

**Recomendación:** Reemplazar el contador en `app_config` por un **SEQUENCE nativo de PostgreSQL** (`CREATE SEQUENCE`, `DEFAULT nextval(...)` o `GENERATED ALWAYS AS IDENTITY`). `nextval()` es lock-free, MVCC-safe, tolerante a huecos y diseñado para alta concurrencia: elimina la serialización y el costo O(#proyectos). Migración: crear el sequence sincronizado a `MAX(id)+1`, apuntar el default de `tasks.id`, y dejar `claim_task_id` como `SELECT nextval('tasks_id_seq')`. Alternativa: reservar el ID al guardar y no al abrir el formulario.

**Esfuerzo estimado:** MEDIO

### H-A02 | ALTO | Arquitectura/Calidad | Cero pruebas automatizadas

**Evidencia:** no existe ningún `*.test.*` / `*.spec.*` ni carpeta `tests/` en el repo (verificado); `package.json` sin script de test real.

**Descripción:** No hay tests unitarios, de integración ni e2e. Toda verificación es manual.

**Impacto:** Para producción es deuda de alto riesgo: cada cambio en un monolito de 9.7k líneas puede romper billing, IA, RLS o cálculo de aporte sin red de seguridad. Refactors (como el de H-A01) son peligrosos sin tests.

**Recomendación:** Empezar por las piezas de mayor riesgo y lógica pura: cálculo de aporte (`calcAporte`), gating de planes (`user_ia_capacity`/`project_can_use_*`), y los endpoints de pago/webhook (firma, idempotencia). CI que los corra en cada push.

**Esfuerzo estimado:** ALTO

### H-A03 | MEDIO | Escalabilidad | El dashboard consolidado agrega en el cliente sin paginación

**Evidencia:** `src/ProductivityPlus.jsx` (ConsolidatedDashboard) — `supabase.from("tasks").select(...).in("project_id", ids)` trae TODAS las tareas de TODOS los tableros del dueño al navegador para agregarlas en JS. Mismo patrón en `loadAllForProject`.

**Descripción:** La Visión consolidada descarga el universo de tareas del dueño y computa KPIs en el cliente. Para un dueño con muchos tableros grandes el payload y el cómputo crecen sin techo.

**Impacto:** Latencia y memoria crecientes justo para los usuarios de pago (que más tableros tienen).

**Recomendación:** Mover la agregación a una RPC server-side (`SECURITY DEFINER` con check de owner) que devuelva los KPIs por tablero ya calculados. Paginar/virtualizar listas largas por tablero.

**Esfuerzo estimado:** MEDIO

### Eje 2 — Seguridad

### H-A04 | ALTO | Seguridad | Webhook de Mercado Pago procesa eventos aunque falte el secreto (fail-open)

**Evidencia:** `api/mp-webhook.js:21-26` (`verifyMpSignature` devuelve `null` si no hay `MP_WEBHOOK_SECRET`), `api/mp-webhook.js:124-126` (con `sigOk === null` solo `console.warn` y continúa), `api/mp-webhook.js:175` (escribe `users_premium` con service_role).

**Descripción:** Si `MP_WEBHOOK_SECRET` no está configurado, la verificación se omite y el handler concede/renueva premium. Coincide con Codex (B/H-003) y Gemini (C/H-002).

**Impacto:** Un error de configuración en producción abre un endpoint que eleva privilegios de facturación a peticiones no firmadas. El usuario ya configuró el secreto, pero el código no es fail-closed: un redeploy sin la var reabriría el hueco silenciosamente.

**Recomendación:** Fail-closed: si no hay secreto o firma válida, responder 401/503 y NO procesar. Validar `MP_WEBHOOK_SECRET` al arranque en producción.

**Esfuerzo estimado:** BAJO

### H-A05 | MEDIO | Seguridad | `service_role` key en texto plano en scripts de siembra

**Evidencia:** `.scratch/seed_massive.py:24` y `.scratch/seed_consolidated.py` (constante `SR` con un JWT `service_role` real). `.scratch/` está en `.gitignore` (verificado), por lo que NO está versionado.

**Descripción:** El secreto `service_role` (acceso total, bypassa RLS) vive en disco en texto plano. No está en git, pero podría filtrarse por backup/captura/cambio futuro del `.gitignore`.

**Impacto:** Si se filtra, es compromiso total de la base de datos.

**Recomendación:** Rotar la `service_role` key por precaución y cargarla desde `.env.local`/variable de entorno en los scripts. Mantener `.scratch/` ignorado.

**Esfuerzo estimado:** BAJO

### Eje 3 — Pentesting interno (defensivo)

### H-A06 | MEDIO | Concurrencia | Actualización de tarjeta sin control de versión (last-write-wins → lost updates)

**Evidencia:** `src/ProductivityPlus.jsx:9013` (`update(dbTask).eq('id', task.id)` sin comparar `updated_at`/versión).

**Descripción:** Dos personas editando la misma tarjeta a la vez: el último `UPDATE` pisa al anterior sin detección de conflicto. El realtime refresca la vista, pero hay ventana de carrera donde un cambio se pierde silenciosamente.

**Impacto:** Pérdida silenciosa de ediciones en trabajo colaborativo concurrente sobre la misma tarjeta.

**Recomendación:** Optimistic concurrency: `.eq('updated_at', prevUpdatedAt)` en el UPDATE; si afecta 0 filas, avisar "esta tarjeta cambió, recarga". O bloqueo suave por presencia.

**Esfuerzo estimado:** MEDIO

> Nota: el IDOR de `sessionId` en el chat (Codex B/H-006) y la inyección HTML en correos de retro (Codex B/H-007) son hallazgos válidos de pentest que Auditor A no exploró en profundidad; se adoptan del contraste.

### Eje 4 — Integridad de conexiones

### H-A07 | MEDIO | Conexión | Errores de guardado se comunican con `alert()` y sin reintento

**Evidencia:** `src/ProductivityPlus.jsx:8992` (`alert('Error al guardar la tarea: ' + error.message)`), patrón repetido.

**Descripción:** Ante fallo de red/insert se muestra `alert()` nativo, sin reintento ni cola offline. Si el insert falla por colisión de PK (fallback de `nextId` en H-A01 bajo fallo de RPC), el usuario pierde el borrador.

**Impacto:** Experiencia frágil bajo mala conexión o concurrencia; `alert()` bloquea el hilo de UI.

**Recomendación:** Toasts no bloqueantes, conservar el borrador ante error y ofrecer reintento. Para el cliente Supabase, considerar el timeout que señala Gemini (C/H-004).

**Esfuerzo estimado:** MEDIO

### Eje 5 — UX / UI

### H-A08 | BAJO | UX | Feedback de error abrupto + accesibilidad de modales

**Evidencia:** `alert()` en flujos de guardado; overlays sin `role="dialog"`/foco (detallado por Codex B/H-010, H-011).

**Descripción:** Los nuevos paneles (Visión consolidada, pastilla Resumen, selección de planes) son visualmente sólidos, pero el manejo de error general usa `alert()` y los modales no atrapan foco ni cierran con `Esc`.

**Impacto:** Roces de usabilidad y accesibilidad (WCAG 2.4.7, patrón de modal accesible).

**Recomendación:** Componente modal común con `role="dialog"`, `aria-modal`, trampa de foco, cierre por `Esc`; `:focus-visible` consistente; toasts para errores.

**Esfuerzo estimado:** MEDIO

## Notas para el orquestador
Auditoría estática centrada en concurrencia/escalabilidad. H-A01 (`claim_task_id`) es el hallazgo más relevante para producción con muchos usuarios y es exclusivo de Auditor A — ni Codex ni Gemini lo detectaron. Los hallazgos de pago/IDOR de Codex y los de bundle/validación de Gemini complementan y se integran en el contraste.
