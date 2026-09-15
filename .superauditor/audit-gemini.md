# Auditoría Gemini — 761daf9..f81fac9

## Metadatos
- Auditor: Gemini (Google)
- Fecha: 2026-09-14T20:58:50-05:00
- Modelo: Gemini 3.1 Pro (High)
- Proyecto: F:/proyectos/w-planner

## Resumen
La refactorización del sistema de autenticación reemplaza de manera efectiva los enlaces mágicos por códigos de un solo uso (OTP) de 8 dígitos, solucionando de raíz el problema del consumo prematuro de tokens por filtros de seguridad corporativos. La implementación demuestra robustez, con una excelente separación de responsabilidades para la publicación de plantillas de correo y buenas prácticas de usabilidad en el ingreso de códigos en el frontend. La delegación de la validación y protección contra fuerza bruta a Supabase es correcta. Solo se identifican áreas de mejora en la configuración estática de URLs por entorno y en la precisión de los temporizadores de la interfaz bajo condiciones de inactividad de pestaña en navegadores modernos.

## Hallazgos

### Eje 1 — Arquitectura
**Evidencia:** `scripts/auth-email/templates.js` (constantes `APP_URL` y `SITE_URL`)
**Severidad:** MEDIO
**Descripción:** Las constantes de las URLs están hardcodeadas apuntando estáticamente a los dominios de producción (`productivityplus.softatumedida.com`). Si el script `apply-auth-email-templates.mjs` se utiliza para desplegar la configuración en un proyecto de Supabase destinado a pruebas o staging, los correos transaccionales seguirán llevando al entorno productivo.
**Impacto:** Esto acopla todos los entornos de backend al frontend de producción, interrumpiendo los flujos de validación de QA y limitando la capacidad del equipo para realizar pruebas aisladas de la autenticación.
**Recomendación:** Permitir la sobrescritura de estas URLs mediante variables de entorno (ej. `process.env.APP_URL`), conservando los valores actuales exclusivamente como comportamiento de fallback predeterminado para mantener la compatibilidad hacia atrás.

### Eje 2 — Seguridad
Sin hallazgos relevantes en esta ronda. El manejo de los códigos y la prevención de fuerza bruta se delegan de manera segura a Supabase Auth. El código frontend (en `AuthScreen.jsx`) implementa correctamente un bloqueo síncrono (`sendingRef.current`) para evitar que dobles clics rápidos o presiones de Enter consecutivas despachen solicitudes duplicadas o agoten los límites de tasa accidentalmente. La lectura de credenciales desde las variables de entorno es segura.

### Eje 3 — Pentesting interno
Sin hallazgos relevantes en esta ronda. Las funciones de validación de entrada provistas (`normalizeOtpInput`, `normalizeEmail`) descartan adecuadamente valores inesperados y previenen la inyección de caracteres malformados antes del envío al servidor. El patrón de expresión regular utilizado no presenta riesgos significativos de ReDoS en el entorno en el que se ejecuta.

### Eje 4 — Conexiones
Sin hallazgos relevantes en esta ronda. Las peticiones dirigidas a la API administrativa de Supabase en los scripts de gestión utilizan robustamente `AbortSignal.timeout` para prevenir bloqueos indefinidos por congestión de red, y gestionan los fallos capturando el texto de error de las respuestas HTTP sin exponer detalles críticos que puedan causar cuelgues del proceso principal.

### Eje 5 — UX/UI
**Evidencia:** `src/screens/AuthScreen.jsx` (función `arrancarCooldown`)
**Severidad:** BAJO
**Descripción:** La lógica del temporizador de reenvío de correos disminuye un contador relativo en memoria usando `setInterval` cada 1000ms. Los navegadores modernos aplican un estrangulamiento (throttling) agresivo a los temporizadores cuando la pestaña en la que operan pasa a segundo plano (reduciendo la frecuencia, por ejemplo, a un tick por minuto), lo que sucederá frecuentemente dado que el usuario dejará la pestaña inactiva temporalmente para abrir su aplicación de correo y revisar el código.
**Impacto:** El contador en el botón de reenvío se desincronizará del tiempo real avanzando mucho más lento. El usuario percibirá que está bloqueado durante más tiempo del requerido por la validación real (los 60 segundos del backend), creando fricción en la experiencia de usuario.
**Recomendación:** Modificar la lógica para calcular el tiempo restante de forma dinámica comparando contra una marca de tiempo absoluta generada en la inicialización (ej. `const endTime = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;`) y hacer que cada iteración del intervalo actualice el contador calculando la diferencia, en lugar de solo decrementar `c - 1`.

## Notas para el orquestador
La evaluación se completó analizando íntegramente las diferencias correspondientes al rango de commits indicado, abarcando las modificaciones tanto en la interfaz React como en el utillaje de plantillas Node.js. No se requirió acceso directo a la infraestructura externa, dado el alcance interno estipulado de la auditoría.
