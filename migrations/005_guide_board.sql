-- ══════════════════════════════════════════════════════════════════════
--  Migration 005 · Tablero Guía — Lanzamiento de Producto Digital
--  Proyecto de demostración completo para Productivity-Plus
--  Incluye: 5 usuarios · 3 sprints · 2 OKRs · 5 KRs · 24 tareas
--  Código de invitación: GUIA-DEMO-2025   |   PIN: guia2025
-- ══════════════════════════════════════════════════════════════════════
BEGIN;

DO $$
DECLARE
  proj_id  BIGINT;
  s1_id    BIGINT;   -- Sprint 1 · Discovery & Diseño    (cerrado)
  s2_id    BIGINT;   -- Sprint 2 · Desarrollo Core       (activo)
  s3_id    BIGINT;   -- Sprint 3 · Lanzamiento           (planificación)
  o1_id    BIGINT;   -- OKR 1
  o2_id    BIGINT;   -- OKR 2
  kr1_id   BIGINT;   kr2_id   BIGINT;   kr3_id   BIGINT;
  kr4_id   BIGINT;   kr5_id   BIGINT;
  base_pid BIGINT;  -- base para IDs de participantes
  base_ind BIGINT;  -- base para IDs de indicadores
  base_tid BIGINT;  -- base para IDs de tareas
  -- Task IDs para dependencias
  t1  BIGINT; t2  BIGINT; t3  BIGINT; t4  BIGINT; t5  BIGINT; t6  BIGINT;
  t7  BIGINT; t8  BIGINT; t9  BIGINT; t10 BIGINT; t11 BIGINT; t12 BIGINT;
  t13 BIGINT; t14 BIGINT; t15 BIGINT; t16 BIGINT; t17 BIGINT; t18 BIGINT;
  t19 BIGINT; t20 BIGINT; t21 BIGINT; t22 BIGINT; t23 BIGINT; t24 BIGINT;
BEGIN

-- ── Evitar duplicado ────────────────────────────────────────────────
IF EXISTS (SELECT 1 FROM projects WHERE invite_code = 'GUIA-DEMO-2025') THEN
  RAISE NOTICE 'El tablero guía ya existe. Saltando inserción.';
  RETURN;
END IF;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  1. PROYECTO
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSERT INTO projects (name, description, invite_code, config) VALUES (
  'Tablero Guia — Lanzamiento Digital',
  'Proyecto de demostracion completo. Explora el tablero, Gantt, metricas, Red de Tareas, OKRs, Sprints y Mi Dia. Codigo de acceso: GUIA-DEMO-2025',
  'GUIA-DEMO-2025',
  jsonb_build_object(
    'pin', 'guia2025',
    'dimensions', jsonb_build_array(
      jsonb_build_object('key','tiempo',      'label','Esfuerzo estimado',      'weight',30,'builtin',true),
      jsonb_build_object('key','dificultad',  'label','Complejidad tecnica',    'weight',35,'builtin',true),
      jsonb_build_object('key','estrategico', 'label','Impacto en lanzamiento', 'weight',35,'builtin',true)
    )
  )
) RETURNING id INTO proj_id;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  2. PARTICIPANTES  (5 personas del equipo)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT COALESCE(MAX(id), 0) + 1 INTO base_pid FROM participants;
INSERT INTO participants (id, name, is_super_user, project_id) VALUES
  (base_pid,   'Ana Martinez',  false, proj_id),
  (base_pid+1, 'Carlos Ruiz',   false, proj_id),
  (base_pid+2, 'Laura Gomez',   false, proj_id),
  (base_pid+3, 'Miguel Torres', false, proj_id),
  (base_pid+4, 'Sofia Herrera', false, proj_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  3. INDICADORES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT COALESCE(MAX(id), 0) + 1 INTO base_ind FROM indicators;
INSERT INTO indicators (id, name, project_id) VALUES
  (base_ind,   'Adopcion de usuarios',     proj_id),
  (base_ind+1, 'NPS (Net Promoter Score)', proj_id),
  (base_ind+2, 'Revenue mensual',          proj_id),
  (base_ind+3, 'Tiempo de respuesta API',  proj_id),
  (base_ind+4, 'Cobertura de pruebas',     proj_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  4. SPRINTS  (1 cerrado · 1 activo · 1 planificacion)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSERT INTO sprints (name, goal, start_date, end_date, status, project_id)
VALUES (
  'Sprint 1 - Discovery & Diseno',
  'Validar el problema con usuarios reales, definir personas y entregar wireframes aprobados por el equipo.',
  '2025-01-13', '2025-01-31', 'closed', proj_id
) RETURNING id INTO s1_id;

INSERT INTO sprints (name, goal, start_date, end_date, status, project_id)
VALUES (
  'Sprint 2 - Desarrollo Core',
  'Construir las funcionalidades principales: autenticacion, dashboard Kanban e integracion de pagos.',
  '2025-02-03', '2025-02-21', 'active', proj_id
) RETURNING id INTO s2_id;

INSERT INTO sprints (name, goal, start_date, end_date, status, project_id)
VALUES (
  'Sprint 3 - Lanzamiento',
  'Beta cerrada con 50 usuarios, correcciones finales y ejecucion del plan de go-to-market.',
  '2025-02-24', '2025-03-14', 'planning', proj_id
) RETURNING id INTO s3_id;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  5. OKRs y KEY RESULTS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSERT INTO okrs (title, description, quarter, year, status, project_id)
VALUES (
  'Lanzar el MVP al mercado en Q1 2025',
  'Entregar funcionalidades core validadas con beta testers y alcanzar las primeras metricas de adopcion del producto.',
  1, 2025, 'active', proj_id
) RETURNING id INTO o1_id;

INSERT INTO key_results (title, target_value, current_value, unit, okr_id)
VALUES ('Funcionalidades core completadas', 100, 65, '%', o1_id)
RETURNING id INTO kr1_id;

INSERT INTO key_results (title, target_value, current_value, unit, okr_id)
VALUES ('NPS promedio en pruebas beta', 8, 0, 'puntos', o1_id)
RETURNING id INTO kr2_id;

INSERT INTO key_results (title, target_value, current_value, unit, okr_id)
VALUES ('Usuarios activos al mes del lanzamiento', 500, 0, 'usuarios', o1_id)
RETURNING id INTO kr3_id;

INSERT INTO okrs (title, description, quarter, year, status, project_id)
VALUES (
  'Construir un proceso de entrega sostenible y de alta calidad',
  'Establecer ritmo de trabajo predecible, pruebas automatizadas y comunicacion efectiva entre todas las areas del equipo.',
  1, 2025, 'active', proj_id
) RETURNING id INTO o2_id;

INSERT INTO key_results (title, target_value, current_value, unit, okr_id)
VALUES ('Velocidad del equipo (tareas finalizadas por sprint)', 10, 7, 'tareas', o2_id)
RETURNING id INTO kr4_id;

INSERT INTO key_results (title, target_value, current_value, unit, okr_id)
VALUES ('Cobertura de pruebas automatizadas', 80, 40, '%', o2_id)
RETURNING id INTO kr5_id;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  6. TAREAS  (base_tid + offset para cada una)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT COALESCE(MAX(id), 0) + 1 INTO base_tid FROM tasks;

-- ──────────────────────────────────────────────────────────────
--  SPRINT 1 · Discovery & Diseno  (6 tareas — todas Finalizadas)
-- ──────────────────────────────────────────────────────────────

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id, kr_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid,
  'Investigacion de mercado y analisis de competidores',
  'Operativa', 'Finalizada', 'Sofia Herrera',
  '2025-01-13', '2025-01-17', 8, 6, 9,
  100,
  'Se analizaron 12 competidores directos e indirectos. Oportunidad clara en el segmento PYME latinoamericano. Hallazgo clave: ninguna herramienta combina prioridad estrategica con gestion visual. Ver: Competitive Analysis v2.pdf',
  proj_id, s1_id, kr1_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NULL
) RETURNING id INTO t1;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+1,
  'Entrevistas en profundidad con 20 usuarios potenciales',
  'Seguimiento', 'Finalizada', 'Ana Martinez',
  '2025-01-13', '2025-01-20', 6, 4, 8,
  100,
  'Insight #1: el 80% usa hojas de calculo para gestionar proyectos y lo detesta. Insight #2: mayor dolor es la falta de visibilidad del progreso en tiempo real. Insight #3: las alertas de bloqueo son la funcionalidad mas deseada. Grabaciones en Google Drive.',
  proj_id, s1_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NULL
) RETURNING id INTO t2;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+2,
  'Definicion de personas y mapa de experiencia del usuario',
  'Creativa', 'Finalizada', 'Laura Gomez',
  '2025-01-20', '2025-01-22', 5, 5, 7,
  100,
  '3 personas validadas: (1) "Gerente PMO Corporativo" — 35-45 anos, gestiona 8+ proyectos, necesita reportes ejecutivos. (2) "Lider tecnico de startup" — 28-35 anos, equipo de 5, necesita visibilidad de blockers. (3) "Coordinador de equipo remoto" — 30-40 anos, equipo distribuido en 3 paises, necesita alineacion de objetivos. Documentado en Notion.',
  proj_id, s1_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t2::TEXT
) RETURNING id INTO t3;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+3,
  'Wireframes de flujos principales: tablero, Gantt y metricas',
  'Creativa', 'Finalizada', 'Laura Gomez',
  '2025-01-20', '2025-01-27', 7, 6, 8,
  100,
  '5 flujos completos documentados: (1) Creacion y asignacion de tareas, (2) Vista Kanban con drag & drop, (3) Gantt interactivo, (4) Dashboard de metricas del equipo, (5) Configuracion de pesos y dimensiones. Iteracion 3 aprobada por todo el equipo. Figma: /wireframes-v3 (compartido con stakeholders).',
  proj_id, s1_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t3::TEXT
) RETURNING id INTO t4;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+4,
  'Validacion de prototipos con usuarios reales (usability testing)',
  'Seguimiento', 'Finalizada', 'Ana Martinez',
  '2025-01-27', '2025-01-31', 4, 4, 9,
  100,
  '8 sesiones de usability testing (Maze). Tasa de exito en tareas: 87%. Tiempo promedio de onboarding: 4.2 min. Ajuste implementado: simplificacion del flujo de creacion de tareas (3 pasos → 2 pasos). Score SUS: 82/100 (Excelente). Grabaciones disponibles.',
  proj_id, s1_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t4::TEXT
) RETURNING id INTO t5;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id, kr_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+5,
  'Arquitectura tecnica y seleccion del stack tecnologico',
  'Operativa', 'Finalizada', 'Carlos Ruiz',
  '2025-01-20', '2025-01-31', 9, 8, 9,
  100,
  'Stack definido y documentado: Frontend: React 19 + Vite + TailwindCSS. Backend: Supabase (PostgreSQL 15 + Auth + Realtime + Storage). Deploy: Vercel (CI/CD automatico). Email: Resend API. Decision documentada en ADR-001. Alternativas descartadas: Next.js (overhead innecesario), Firebase (costo a escala), AWS (complejidad operacional).',
  proj_id, s1_id, kr1_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t1::TEXT
) RETURNING id INTO t6;

-- ──────────────────────────────────────────────────────────────
--  SPRINT 2 · Desarrollo Core  (10 tareas — progreso mixto)
-- ──────────────────────────────────────────────────────────────

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+6,
  'Sistema de diseno y libreria de componentes UI (Design System)',
  'Creativa', 'Finalizada', 'Laura Gomez',
  '2025-02-03', '2025-02-07', 8, 7, 8,
  100,
  'Design System completo: tipografia (Inter + JetBrains Mono), paleta de 60 colores con tokens, iconografia (Lucide), 40+ componentes en Storybook (botones, inputs, modales, tarjetas, tablas, graficas). Modo oscuro incluido. Documentacion en Zeroheight.',
  proj_id, s2_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t4::TEXT
) RETURNING id INTO t7;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id, kr_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+7,
  'Configuracion de infraestructura cloud y pipeline CI/CD',
  'Operativa', 'Finalizada', 'Carlos Ruiz',
  '2025-02-03', '2025-02-07', 6, 7, 7,
  100,
  'GitHub Actions configurado con 3 pipelines: test + build + deploy. Entornos: development, staging y production. Supabase con backups diarios automaticos, row-level security y migraciones versionadas. Alertas de Uptime en Vercel. SLA objetivo: 99.9%.',
  proj_id, s2_id, kr5_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t6::TEXT
) RETURNING id INTO t8;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id, kr_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+8,
  'API de autenticacion: login, registro y recuperacion de cuenta',
  'Operativa', 'En proceso', 'Carlos Ruiz',
  '2025-02-10', '2025-02-14', 7, 8, 9,
  75,
  'Login con email/password: LISTO. Registro con verificacion de email: LISTO. Recuperacion de contrasena: LISTO. Magic links: LISTO. SSO con Google: EN PROGRESO (estimado +1 dia). Pendiente: tests de integracion (cobertura actual: 60%).',
  proj_id, s2_id, kr1_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t8::TEXT
) RETURNING id INTO t9;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id, kr_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+9,
  'Modulo de usuarios, roles y permisos granulares',
  'Operativa', 'En proceso', 'Miguel Torres',
  '2025-02-10', '2025-02-17', 8, 8, 8,
  60,
  'CRUD de usuarios: COMPLETO. Roles implementados: owner (acceso total), editor (crear/editar tareas), viewer (solo lectura). Invitacion por email con link unico: COMPLETO. Pendiente: UI de gestion de permisos granulares por proyecto y auditoria de accesos.',
  proj_id, s2_id, kr1_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t9::TEXT
) RETURNING id INTO t10;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id, kr_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+10,
  'Dashboard principal: tablero Kanban, Gantt y vistas de proyecto',
  'Operativa', 'En proceso', 'Miguel Torres',
  '2025-02-10', '2025-02-21', 9, 9, 10,
  50,
  'Kanban con 7 columnas y drag & drop: COMPLETO. Gantt con barras de duracion y dependencias: COMPLETO. Vista de Metricas con graficas: EN PROGRESO (60%). Red de dependencias (grafo DAG): EN PROGRESO (40%). Pendiente: filtros avanzados multi-criterio, exportacion PDF y modo Mi Dia.',
  proj_id, s2_id, kr1_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t10::TEXT
) RETURNING id INTO t11;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id, kr_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+11,
  'Integracion de pasarela de pagos con Stripe',
  'Operativa', 'Sin iniciar', 'Carlos Ruiz',
  '2025-02-17', '2025-02-21', 8, 9, 9,
  0,
  'Planes a implementar: Free (1 proyecto, 5 usuarios), Pro $19/mes (10 proyectos, usuarios ilimitados, AI reports), Enterprise $79/mes (ilimitado + SLA + soporte dedicado). Webhooks para suscripciones, upgrades y cancelaciones. Portal de cliente de Stripe para autogestion. Pendiente arquitectura de billing.',
  proj_id, s2_id, kr1_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t9::TEXT
) RETURNING id INTO t12;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+12,
  'Diseno responsive y adaptacion a dispositivos moviles',
  'Creativa', 'En proceso', 'Laura Gomez',
  '2025-02-10', '2025-02-17', 6, 6, 7,
  70,
  'Breakpoints definidos: 320px, 768px, 1024px, 1440px. Tablero Kanban responsivo: 100%. Gantt en movil (scroll horizontal): 100%. Vista de Metricas: 80%. Pendiente: optimizacion de graficas en pantallas <768px y ajuste del panel de configuracion.',
  proj_id, s2_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t7::TEXT
) RETURNING id INTO t13;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+13,
  'Estrategia de contenidos, blog tecnico y SEO pre-lanzamiento',
  'Administrativa', 'En proceso', 'Sofia Herrera',
  '2025-02-03', '2025-02-21', 5, 4, 7,
  40,
  'Plan editorial: 10 articulos definidos, 3 publicados. Keywords objetivo: "gestion de proyectos para equipos", "productividad equipos latam", "alternativa a Monday en espanol". Landing page con formulario de waitlist: en construccion (630 leads acumulados). Alianzas con 2 podcasts de productividad para menciones el dia del lanzamiento.',
  proj_id, s2_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NULL
) RETURNING id INTO t14;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id, kr_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+14,
  'Pruebas de seguridad y auditoria OWASP Top 10',
  'Seguimiento', 'Sin iniciar', 'Carlos Ruiz',
  '2025-02-17', '2025-02-21', 6, 9, 9,
  0,
  'Checklist OWASP Top 10 para revision manual. Herramientas: OWASP ZAP (scan automatico), Snyk (dependencias), Burp Suite (endpoints criticos). Alcance: endpoints de auth, APIs de datos, carga de archivos y webhooks de Stripe. Resultado esperado: informe ejecutivo + correccion de hallazgos criticos/altos.',
  proj_id, s2_id, kr5_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t9::TEXT
) RETURNING id INTO t15;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+15,
  'Auditoria de accesibilidad WCAG 2.1 nivel AA',
  'Seguimiento', 'Bloqueada', 'Laura Gomez',
  '2025-02-17', '2025-02-21', 4, 5, 7,
  0,
  'BLOQUEADA esperando que el dashboard principal alcance al menos 80% de avance para auditar correctamente todos los componentes. Herramientas planificadas: axe DevTools, NVDA (screen reader), Colour Contrast Analyser. Areas de mayor riesgo: graficas SVG, modales de edicion y tabla de Gantt.',
  proj_id, s2_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t11::TEXT
) RETURNING id INTO t16;

-- ──────────────────────────────────────────────────────────────
--  SPRINT 3 · Lanzamiento  (8 tareas — todas Sin iniciar)
-- ──────────────────────────────────────────────────────────────

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id, kr_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+16,
  'Pruebas de carga y optimizacion de rendimiento',
  'Seguimiento', 'Sin iniciar', 'Carlos Ruiz',
  '2025-02-24', '2025-02-28', 7, 8, 8,
  0,
  'Objetivo de rendimiento: P95 < 200ms, P99 < 500ms. Herramientas: k6 (carga) + Lighthouse (frontend) + pgBench (base de datos). Escenario de prueba: 1000 usuarios concurrentes durante 30 minutos. Bottlenecks anticipados: queries N+1 en el Gantt y renderizado de graficas SVG con muchos nodos.',
  proj_id, s3_id, kr5_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t11::TEXT
) RETURNING id INTO t17;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id, kr_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+17,
  'Beta cerrada con 50 usuarios seleccionados',
  'Seguimiento', 'Sin iniciar', 'Ana Martinez',
  '2025-03-03', '2025-03-07', 8, 6, 10,
  0,
  'Criterios de seleccion: usuarios activos de Monday, Asana o ClickUp que manifestaron frustracion. Canal: waitlist + comunidades Slack. Protocolo: acceso 2 semanas, feedback estructurado cada 3 dias, NPS al final. Meta: NPS > 8, identificar top 3 bugs criticos y top 3 mejoras deseadas. Incentivo: Plan Pro gratis por 6 meses.',
  proj_id, s3_id, kr2_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t17::TEXT
) RETURNING id INTO t18;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id, kr_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+18,
  'Campana de pre-lanzamiento en redes y comunidades',
  'Operativa', 'Sin iniciar', 'Sofia Herrera',
  '2025-02-24', '2025-03-07', 6, 5, 9,
  0,
  'Canales priorizados: LinkedIn (decision makers), Twitter/X (devs y fundadores), Reddit r/projectmanagement y r/latinoamerica, Slack communities (300+ miembros en ProductHackers Latam, GrowthLatam, Founders es). Contenido planificado: 3 posts de problema/solucion, 2 demos en video corto, 1 thread "como construimos esto". Meta: 1000 personas en waitlist antes del lanzamiento.',
  proj_id, s3_id, kr3_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t14::TEXT
) RETURNING id INTO t19;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+19,
  'Documentacion, guias de usuario y materiales de onboarding',
  'Administrativa', 'Sin iniciar', 'Ana Martinez',
  '2025-03-03', '2025-03-07', 4, 3, 6,
  0,
  'Entregables: (1) Guia de inicio rapido (< 5 min para primera tarea). (2) FAQ con top 20 preguntas de beta. (3) Base de conocimiento en Notion (organizada por rol). (4) 5 videos tutoriales de flujos principales (< 3 min cada uno, con subtitulos). (5) Tooltips de onboarding in-app para nuevos usuarios. Formato: espanol + ingles.',
  proj_id, s3_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t18::TEXT
) RETURNING id INTO t20;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id, kr_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+20,
  'Configuracion de analytics, eventos y dashboards de negocio',
  'Operativa', 'Sin iniciar', 'Miguel Torres',
  '2025-02-24', '2025-03-07', 5, 6, 8,
  0,
  'Mixpanel: eventos de activacion (primera tarea creada, primer colaborador invitado, primer proyecto completado), retencion D1/D7/D30, funnels de conversion a Pro. Google Analytics 4: trafico organico, campanas UTM, tasas de conversion de landing. Dashboard ejecutivo en Metabase: MRR, churn, NPS por cohorte, DAU/MAU. Alertas automaticas para caidas anormales.',
  proj_id, s3_id, kr3_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t11::TEXT
) RETURNING id INTO t21;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id, kr_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+21,
  'Lanzamiento publico: Product Hunt + comunidades tech',
  'Operativa', 'Sin iniciar', 'Sofia Herrera',
  '2025-03-10', '2025-03-10', 9, 7, 10,
  0,
  'Dia D: hunter asignado (seguidor con 500+ seguidores en PH). Publicacion a las 12:01am PST. Plan de accion: (1) Notificar a toda la red personal por WhatsApp/email, (2) Post en todas las comunidades simultaneamente, (3) Responder TODOS los comentarios en primeras 24h, (4) Actualizar estado cada 2h durante el dia. Meta: Top 5 del dia, Featured en newsletter de PH. Backup: AppSumo si no se logra Top 5.',
  proj_id, s3_id, kr3_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t19::TEXT
) RETURNING id INTO t22;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+22,
  'Comunicado de prensa y outreach a medios y bloggers tech',
  'Administrativa', 'Sin iniciar', 'Sofia Herrera',
  '2025-03-07', '2025-03-10', 5, 5, 8,
  0,
  '30 medios y bloggers tech latinoamericanos identificados: Hipertextual, Enter.co, TechLatam, b21.cl, Medium ESP, y 25 newsletters independientes con 5k+ suscriptores. Embargo hasta las 12:00pm del dia de lanzamiento. Kit de prensa incluye: comunicado oficial, capturas de pantalla HD, demos en video, datos de traccion de beta y citas del fundador.',
  proj_id, s3_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t19::TEXT
) RETURNING id INTO t23;

INSERT INTO tasks (
  id, title, type, status, responsible,
  start_date, end_date, estimated_time, difficulty, strategic_value,
  progress_percent, comments,
  project_id, sprint_id, kr_id,
  subtasks, indicators, dimension_values, dependent_task
) VALUES (
  base_tid+23,
  'War room post-lanzamiento: monitoreo y respuesta rapida 72h',
  'Seguimiento', 'Sin iniciar', 'Ana Martinez',
  '2025-03-10', '2025-03-14', 7, 6, 9,
  0,
  'Protocolo war room primeras 72h: (1) Rotacion de guardia 8h cada persona. (2) Alertas PagerDuty para errores criticos y caida de servicios. (3) Dashboard en tiempo real: errores 5xx, latencia, NPS, tickets de soporte. (4) Canal Slack #war-room con updates cada hora. (5) Criterio de rollback: error rate > 5% o P95 > 2s sostenido por 10min. (6) Comunicacion proactiva en redes ante cualquier incidente.',
  proj_id, s3_id, kr2_id,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, t22::TEXT
) RETURNING id INTO t24;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--  7. NOTIFICACIONES DE BIENVENIDA
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSERT INTO notifications (project_id, message, type, read_by) VALUES
  (proj_id, 'Bienvenido al Tablero Guia. Este es un proyecto de demostracion con 24 tareas reales, 5 participantes, 3 sprints y 2 OKRs. Exploralo libremente.', 'info', '{}'),
  (proj_id, 'BLOQUEADA: La auditoria de accesibilidad (tarea #16) esta bloqueada esperando avance del dashboard principal (tarea #11).', 'warning', '{}'),
  (proj_id, 'Sprint 2 activo: Carlos tiene 3 tareas en paralelo. Riesgo de cuello de botella en el area de backend esta semana.', 'warning', '{}'),
  (proj_id, 'OKR "Lanzar MVP Q1 2025" al 65% de funcionalidades completadas. Sprint 3 comienza en 3 dias.', 'info', '{}');

RAISE NOTICE 'Tablero Guia creado exitosamente. Proyecto ID: %', proj_id;
RAISE NOTICE 'Codigo de invitacion: GUIA-DEMO-2025  |  PIN configuracion: guia2025';

END $$;

COMMIT;
