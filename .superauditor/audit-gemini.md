# Auditoría Gemini — 1a90dc1..52ca539

## Metadatos
- Auditor: Gemini (Google)
- Fecha: 2026-06-22T13:18:38-05:00
- Modelo: Gemini 3.1 Pro (High)
- Proyecto: C:/Users/jefer/proyectos/w-planner

## Resumen
El proyecto presenta una estructura funcional que interactúa de manera eficiente con las API de IA y pagos, implementando buenas prácticas como el manejo de timeouts. Sin embargo, arrastra una deuda técnica extrema en el frontend, lo que compromete gravemente su mantenibilidad y rendimiento a futuro. Adicionalmente, se detectó una vulnerabilidad crítica de tipo *Fail-Open* en el webhook de Mercado Pago que podría exponer el sistema de suscripciones a falsificaciones si ocurre una desconfiguración del entorno.

## Hallazgos

### Eje 1 — Arquitectura
### H-001 | CRÍTICO | Arquitectura | Frontend monolítico extremo

**Evidencia:** `src/ProductivityPlus.jsx:1`

**Descripción:** Toda la aplicación de React reside en un único componente masivo de más de 9700 líneas. Existe una mezcla profunda de lógica de presentación, reglas de negocio, manejo del estado global y peticiones a la base de datos (Supabase).

**Impacto:** Riesgo inminente para la mantenibilidad. La adición de nuevas características, refactorización o corrección de errores es peligrosa e incrementa enormemente el esfuerzo de desarrollo y onboarding de nuevos programadores.

**Recomendación:** Iniciar un proceso de refactorización gradual. Separar componentes funcionales y de UI (vistas, modales, botones) en `src/components/`, extraer las interacciones con Supabase a `src/services/` o ganchos personalizados (`src/hooks/`), e introducir React Router u otro sistema de enrutado.

**Esfuerzo estimado:** ÉPICO

### Eje 2 — Seguridad
### H-002 | CRÍTICO | Seguridad | Validación Fail-Open en Webhook de Mercado Pago

**Evidencia:** `api/mp-webhook.js:21-23` y `api/mp-webhook.js:124-126`

**Descripción:** La función `verifyMpSignature` está configurada para devolver `null` si la variable de entorno `MP_WEBHOOK_SECRET` no está presente. El handler recibe este valor y en lugar de bloquear el proceso de forma estricta, arroja una advertencia (`console.warn`) pero procede a conceder o renovar privilegios Premium mediante la escritura en la base de datos de usuarios en las líneas posteriores.

**Impacto:** Si la variable no está configurada, se desactiva silenciosamente la seguridad y cualquier actor malintencionado podría realizar Spoofing, simulando pagos falsos y habilitando su cuenta de manera ilícita (elevación de privilegios de facturación).

**Recomendación:** Modificar el flujo para que sea *Fail-Closed*. Si la firma o el secreto no están presentes, la validación debe devolver `false` u obligar al endpoint a responder con `401 Unauthorized` o `503 Service Unavailable`, bloqueando la operación independientemente de si es producción o desarrollo.

**Esfuerzo estimado:** BAJO

### Eje 3 — Pentesting interno
### H-003 | MEDIO | Seguridad/Pentesting | Ausencia de validación estricta de esquemas en API

**Tipo de vulnerabilidad:** Falta de validación de entrada
**Superficie:** Endpoints HTTP (ej. `/api/mp-subscribe.js`, `/api/generate-scrum-report.js`)
**Evidencia:** `api/generate-scrum-report.js:234`
**Vector intentado (resumido):** Inyección de payloads anómalos o malformados, o uso de tipos de datos incorrectos en el `req.body`, explotando asunciones no verificadas antes de su consumo o propagación hacia componentes subyacentes.
**Resultado:** REQUIERE INVESTIGACIÓN MANUAL
**Fix recomendado:** Implementar una biblioteca como Zod, Joi o Yup para definir y validar formalmente los esquemas en todas las entradas del Request antes de procesarlas (e.g., comprobando tipos exactos de fechas y la presencia de identificadores obligatorios).
**Esfuerzo estimado:** MEDIO

### Eje 4 — Conexiones
### H-004 | MEDIO | Conexiones | Cliente Supabase sin timeout estricto configurado

**Conexión afectada:** API Supabase Base de Datos
**Evidencia:** `api/_auth.js:103-112`
**Síntoma:** Mientras que las interacciones con APIs HTTP estándar se protegen mediante el wrapper local `fetchWithTimeout`, la conexión delegada a `createClient` (Supabase) depende del `fetch` por defecto sin señal de aborto forzada, arriesgando un agotamiento de los hilos si ocurren ralentizaciones en la conexión a la base de datos remota.
**Impacto:** Las fallas de latencia en la base de datos subyacente podrían causar la retención prolongada de invocaciones Serverless/Edge hasta consumir la penalización total del entorno de despliegue.
**Recomendación:** Inyectar una instancia envuelta (o pasar un `fetch` personalizado derivado de `fetchWithTimeout` dentro del parámetro `global.fetch` de las opciones del cliente) al invocar `createClient`.
**Esfuerzo estimado:** BAJO

### Eje 5 — UX/UI
### H-005 | ALTO | UX | Carga sincrónica ineficiente del bundle masivo

**Pantalla / componente afectado:** Aplicación completa (`ProductivityPlus.jsx`)
**Evidencia:** `src/ProductivityPlus.jsx:1`
**Descripción:** La totalidad de las interfaces de usuario (Modales de configuración, Guía de Onboarding, Dashboards consolidados, Visor de Reportes) están empaquetadas en un único archivo JS, forzando la descarga inicial de toda la experiencia sin discriminación de rutas.
**Criterio violado:** Performance percibida y TTI (Time to Interactive).
**Recomendación:** Implementar `React.lazy` y dividir el código (Code Splitting). Los elementos pesados, como la gestión de suscripciones, reportes IA o modales de configuración infrecuentes, deberían cargarse asincrónicamente al ser requeridos por el usuario, mejorando la métrica CLS y First Paint.
**Esfuerzo estimado:** MEDIO

## Notas para el orquestador
El entorno de auditoría enfocó su evaluación en la sanidad técnica general, sin efectuar exfiltración de registros o ataques denegación. Se ignoraron hallazgos menores sin relevancia en este contexto como reglas lint en los comentarios. No se realizaron validaciones físicas de RLS (Supabase) al estar limitados únicamente a la inspección de código estático y las plantillas migradas del repositorio.
