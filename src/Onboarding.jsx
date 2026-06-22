// Onboarding guiado: modal de bienvenida + tour spotlight.
// El usuario elige rol (Scrum Master / PO / Participante) y recibe un
// tour de pasos con tooltip flotante apuntando a los botones reales.
// Estado persistido en public.user_onboarding (migración 024).
//
// Cómo agregar pasos: edita TOUR_SCRIPTS abajo. Cada paso tiene:
//   { tab?, target?, title, body, emoji, placement? }
// - tab: id de TAB que debe estar activa (el tour la activa antes de pintar).
// - target: CSS selector del elemento real (usar data-tour="..." en el JSX).
// - sin target: paso informativo, modal centrado.

import React, { useEffect, useState, useRef, useLayoutEffect } from "react";

const ROLES = {
  scrum_master: {
    label: "Scrum Master",
    emoji: "🎯",
    color: "#149cac",
    gradient: "linear-gradient(135deg,#0e7480,#149cac)",
    pitch: "Facilitas el proceso, destrabas al equipo, cuidas el ritmo del sprint.",
  },
  po: {
    label: "Product Owner",
    emoji: "👔",
    color: "#542c9c",
    gradient: "linear-gradient(135deg,#3a1f6e,#542c9c)",
    pitch: "Defines el qué y el por qué. Priorizas backlog, lees métricas, decides el rumbo.",
  },
  participant: {
    label: "Participante",
    emoji: "💪",
    color: "#ec6c04",
    gradient: "linear-gradient(135deg,#c95903,#ec6c04)",
    pitch: "Ejecutas tareas, reportas avances, te coordinas con el equipo.",
  },
};

// ─── Scripts por rol ──────────────────────────────────────────
const TOUR_SCRIPTS = {
  scrum_master: [
    {
      emoji: "🎯",
      title: "Hola, Scrum Master",
      body: "Te voy a llevar 6 paradas para que veas tu zona de control. Si en algún punto te pierdes, puedes saltar el tour y volver desde tu menú de usuario.",
    },
    {
      tab: "sprints",
      target: '[data-tour="tab-sprints"]',
      emoji: "🏃",
      title: "Sprints: el ciclo del proceso",
      body: [
        { label: "Qué es", text: "Una ventana de tiempo (típicamente 2 semanas) durante la cual el equipo se compromete con un set específico de tareas. Aquí los creas, los activas y los cierras. El sprint es la unidad de ritmo del equipo." },
        { label: "Cómo se conectan con las tareas", text: "Cada sprint tiene fecha inicio y fin. Cuando creas una tarea, el dropdown 'Sprint' del formulario se filtra automáticamente: aparecen primero los sprints cuya ventana contiene la fecha de creación, los fuera de rango bajan con un aviso. Esto evita asignar tareas a sprints cerrados o que no han empezado." },
        { label: "Estados del sprint", text: "Planning (sin empezar, edita libremente) → Active (en curso, el reporte Scrum lo lee) → Closed (terminado, dispara la encuesta de Pulso del equipo a los participantes que tocaron tareas durante el sprint)." },
        { label: "Errores comunes", text: "1) Sprints de 1 mes, pierdes el ritmo del feedback. 2) No cerrar formalmente, el pulso y la retro no se disparan y el equipo se acostumbra a la falta de cierre. 3) Cambiar fechas de un sprint Active, las tareas vinculadas pueden quedar fuera de rango de repente y confundir los reportes." },
        { label: "Tip pro (SM)", text: "Cierra el sprint el último día por la tarde, no esperes al lunes. Esto envía la invitación a la retro mientras el contexto está fresco. Si quieres dar 1 día más al equipo, mueve el end_date durante planning, no en la última hora." },
      ],
    },
    {
      tab: "okrs",
      target: '[data-tour="tab-okrs"]',
      emoji: "🧭",
      title: "OKRs: alineación de la ejecución a la estrategia",
      body: [
        { label: "Qué son", text: "Objective + Key Results. El objetivo es cualitativo y ambicioso ('Lanzar app móvil con tracción real'); los KRs son cuantitativos y medibles ('1000 usuarios beta', 'NPS > 40', 'Crash rate < 1%'). Un OKR sin KRs no se puede medir; un KR sin OKR carece de contexto." },
        { label: "Cómo se conectan con las tareas", text: "Cada KR tiene fecha inicio y fin (igual que sprints). Las tareas se vinculan a un KR desde el formulario, dropdown filtrado por fecha. Vinculas tareas → el progreso del KR se calcula automáticamente como % de tareas finalizadas. Cero manual." },
        { label: "Qué leen los reportes y el evolutivo", text: "El reporte semanal y mensual segmentan trabajo por OKR. El evolutivo bimensual menciona a las personas que más empujaron cada KR. Sin tareas vinculadas a KRs, esta inteligencia desaparece y los reportes se quedan en métricas planas." },
        { label: "Errores comunes (que el SM debe ayudar a corregir)", text: "1) 10 OKRs por trimestre, nada es prioritario. Recomendado: 2-3 OKRs activos. 2) KRs sin métrica numérica ('Mejorar UX' no es un KR, 'NPS > 50' sí). 3) Tareas creadas sin KR, el reporte no entiende qué empuja al objetivo. Recordatorio en planning." },
        { label: "Tip pro (SM)", text: "Antes de cada planning, revisa los OKRs activos y pregunta tarea por tarea: ¿esta empuja a algún KR? Si no, ¿por qué la hacemos? Esto convierte tus planning en conversaciones de estrategia, no de operación." },
      ],
    },
    {
      tab: "board",
      target: '[data-tour="tab-board"]',
      emoji: "📋",
      title: "Tablero: el estado real",
      body: "Aquí ves todas las tareas con su responsable, estado y aporte calculado. Como SM, tu trabajo es destrabar, no asignar. Filtra por persona si necesitas hacer 1:1.",
    },
    {
      tab: "pulse",
      target: '[data-tour="tab-pulse"]',
      emoji: "🌡",
      title: "Pulso del equipo: voz cruda de tu gente",
      body: [
        { label: "Qué es", text: "Al cerrar un sprint, cada participante que tocó tareas recibe una invitación a una mini-retro de 5 minutos: 1 emoji (cómo se sintió) + 2 párrafos (lo que les gustó / lo que no) + 3 señalizaciones anónimas a compañeros (guerrero estratégico / podría dar más / la pasó difícil). Tienen 7 días para responder." },
        { label: "Cómo se ve aquí", text: "Esta vista te muestra el agregado por sprint cerrado: distribución de emojis (cuántos 💪 vs 😴), rankings anónimos de las 3 señalizaciones con conteos, y los textos completos sin atribución. La identidad de quién envió cada señal es invisible, solo el sistema sabe; tú ves agregados." },
        { label: "Cómo usarlo en la retro", text: "Empieza por la distribución de emojis: '¿Por qué este sprint hay más 😴 que el anterior?'. Sigue con los textos agregados. Termina con las señalizaciones: las personas reconocidas como guerreros (4+ votos) merecen reconocimiento público; las marcadas 'la pasaron difícil' merecen un 1:1 contigo sin esperar a la siguiente retro." },
        { label: "Errores comunes", text: "1) Tratar de adivinar quién envió cada señal, rompe la confianza del sistema. 2) Confrontar a alguien en plena retro con 'tú apareces como could_give_more', escalada innecesaria; 1:1 privado. 3) Ignorar el pulso bajo asumiendo 'ya pasará', sprint con 3+ 😴/😡 sin acción se vuelve patrón." },
        { label: "Tip pro (SM)", text: "Documenta el pulso por sprint en tu cuaderno. Después de 3-4 sprints, los patrones aparecen: 'Pedro siempre recibe could_give_more cuando hay sprints con muchas tareas técnicas', eso te dice de su asignación, no de su voluntad. Es la información más honesta que vas a tener sobre tu equipo." },
      ],
    },
    {
      emoji: "✉️",
      title: "Reportes automáticos",
      body: "Cada miércoles y viernes sale el reporte Scrum por correo (alertas, tareas atascadas, próximas a vencer). No tienes que hacer nada. Ahora voy a llevarte por la Configuración para que veas todo lo que puedes ajustar.",
    },
    {
      tab: "config",
      target: '[data-tour="tab-config"]',
      emoji: "⚙️",
      title: "Configuración: tu cuarto de máquinas",
      body: "Aquí ajustas cómo se comporta el proyecto: a quién invitas, qué métricas mides, cómo se calcula el aporte, qué reportes salen y a quién. Tu rol como SM vive aquí casi tanto como en el tablero.",
    },
    {
      tab: "config",
      target: '[data-tour="config-project"]',
      emoji: "🏗️",
      title: "Proyecto + invitaciones por correo",
      body: "Datos básicos del proyecto y el campo para invitar gente nueva por email. La invitación llega con un código de 6 dígitos y se vincula automáticamente al miembro cuando se registra. Aquí también ves el código de invitación general.",
    },
    {
      tab: "config",
      target: '[data-tour="config-people"]',
      emoji: "👥",
      title: "Participantes del proyecto",
      body: "Lista completa de quien está dentro. Puedes marcar a alguien como super-usuario (admin) o quitarlo. Este registro alimenta los selects de 'Responsable' al crear tareas y los reportes.",
    },
    {
      tab: "config",
      target: '[data-tour="config-indicators"]',
      emoji: "📊",
      title: "Indicadores clave: KPIs vivos del proyecto",
      body: [
        { label: "Qué son", text: "Métricas medibles que definen si el proyecto va bien. Ejemplos típicos: NPS, conversión, tiempo de carga p95, # bugs en producción, retención semanal. No confundir con OKRs: los OKRs son el destino del trimestre, los indicadores son las señales operativas que sigues semana a semana." },
        { label: "Cómo se conectan con las tareas", text: "Cada tarea puede etiquetarse con uno o varios indicadores que impacta. Cuando una tarea finaliza, su aporte se atribuye a esos indicadores en los reportes. El reporte semanal y el mensual segmentan progreso por indicador: '12 tareas finalizadas impactaron NPS este mes'." },
        { label: "Diferencia con OKRs", text: "OKR = compromiso del trimestre con meta y deadline ('NPS > 40 en Q2'). Indicador = métrica continua que sigues siempre ('NPS', sin meta específica). Un indicador puede tener varios OKRs a lo largo del año; un OKR es un esfuerzo concreto de mover ese indicador." },
        { label: "Errores comunes", text: "1) Crear 20 indicadores, el equipo no etiqueta tareas porque no encuentra cuál aplica. 2) Indicadores demasiado generales ('Calidad') vs. específicos ('Crash-free sessions %'). Específico siempre gana. 3) No mantenerlos: indicador que nadie ya mide en producción debería borrarse o el reporte miente." },
        { label: "Tip pro", text: "Empieza con 3-5 indicadores que el equipo entiende y puede ver moverse en una semana. Si necesitas más, agrégalos cuando aparezca la necesidad real, no preventivamente. Revisa la lista cada quarter: ¿siguen siendo los que importan? Quita los que no." },
      ],
    },
    {
      tab: "config",
      target: '[data-tour="config-types"]',
      emoji: "🧩",
      title: "Tipos de tarea",
      body: "Categorías por defecto: Estratégica, Operativa, Técnica, Diseño, etc. Personalízalas a tu industria. Los reportes IA segmentan por tipo para mostrarte balance entre estratégico vs operativo.",
    },
    {
      tab: "config",
      target: '[data-tour="config-calculator"]',
      emoji: "⚖️",
      title: "Calculadora de Aporte (define qué se valora)",
      body: [
        { label: "Qué es", text: "La fórmula que convierte cada tarea en un número único (su Valor de Aporte). Trae 3 dimensiones por defecto (Tiempo, Dificultad, Impacto Estratégico) pero puedes AGREGAR las que tu proyecto necesite (complejidad técnica, riesgo, dependencias externas, alineación con OKR…) o QUITAR las que no apliquen. La calculadora se adapta al proyecto, no al revés." },
        { label: "Cómo funciona", text: "Cada dimensión tiene un peso 1-100, idealmente sumando 100 entre todas. Cada tarea recibe un valor 1-10 por dimensión. Aporte = suma(valor × peso) / 100. Ejemplo: Tiempo=30, Dificultad=30, Estratégico=40 (pesos). Tarea con valores 7/8/10 = (7×30 + 8×30 + 10×40)/100 = 8.5 puntos. Tarea trivial 3/2/4 = 3.1 puntos. Ese diferencial es lo que tu equipo verá en el board y los reportes." },
        { label: "Qué pasa con las tareas viejas cuando cambias pesos", text: "Esto es lo importante: cada tarea guarda su aporte CALCULADO al momento de crearla o editarla (un snapshot). Cambiar pesos NO recalcula las tareas existentes, quedan congeladas con la fórmula vieja. Resultado: después de un cambio coexisten dos reglas en el mismo proyecto y la comparativa entre sprints se vuelve ruido (peras vs manzanas). Si necesitas la nueva fórmula también en lo viejo, debes re-editar cada tarea manualmente. Por eso conviene definir bien al inicio." },
        { label: "Errores comunes", text: "1) Subir 'urgencia' al 50 porque 'siempre hay urgencias', todo se vuelve urgente y nada destaca. 2) Crear 10 dimensiones, el equipo no las llena bien, dejan valor default 5 y la calculadora se vuelve ruido. 3) Cambiar pesos cuando un participante se queja de no aparecer arriba: estás corrigiendo el síntoma, no la causa." },
        { label: "Tip pro (SM)", text: "Como SM tu rol con la calculadora es CUSTODIO, no reformador. Ayuda al PO a definirla al kick-off, defiéndela cuando alguien quiera cambiarla a mitad de sprint, y úsala en retro para identificar tareas mal estimadas (valor real vs valor declarado). Si DE VERDAD necesitas medir algo nuevo, AGREGAR una dimensión nueva rompe menos que reajustar pesos viejos." },
      ],
    },
    {
      tab: "config",
      target: '[data-tour="config-fields"]',
      emoji: "🧬",
      title: "Campos personalizados de la tarjeta",
      body: "Si tu proyecto necesita campos extras en cada tarea (ej. presupuesto, riesgo regulatorio, link a Jira), créalos aquí. Eliges tipo (texto, select, fecha, multiselect, subitems) y si se muestra en la tarjeta. Quitar un campo conserva los datos históricos.",
    },
    {
      tab: "config",
      target: '[data-tour="config-reports"]',
      emoji: "📬",
      title: "Reportes IA por correo: tu narrativa automática",
      body: [
        { label: "Qué son", text: "Tres reportes generados por IA y enviados por correo en fechas configuradas. Cada uno tiene audiencia, modelo y costo distintos. NO hay envío manual, solo salen en la fecha programada para mantener cadencia y evitar disparos accidentales que inflen el costo." },
        { label: "Reporte Scrum (bi-semanal)", text: "Operativo, para el equipo técnico. Tareas atascadas, próximas a vencer, alertas. Configurable: hasta 2 días por semana (default miércoles 8am + viernes 5pm) usando Gemini 2.5 Flash. Costo ≈ $0.30/proyecto/mes. Tu reporte como SM." },
        { label: "Reporte Semanal del PO (lunes 8am)", text: "Narrativa ejecutiva. Métricas, análisis por persona, recomendaciones de qué hacer la próxima semana. Modelo Sonnet 4.6 con caching. Costo ≈ $0.40/proyecto/mes. Cadencia fija, no es configurable el día." },
        { label: "Análisis Mensual del Equipo (1er lunes del mes)", text: "Privado, solo para el owner. El más profundo: ejes del equipo, vende-humo, lentos, repetitivos, comparativa con meses anteriores. Modelo Sonnet 4.6 con caching. Costo ≈ $0.12/proyecto/mes." },
        { label: "Tip pro (SM)", text: "Los destinatarios son por reporte, no global. Puedes mandar el Scrum a un canal de Slack (con un email-to-channel) sin que el equipo reciba el Semanal del PO. Mantén el Mensual restringido al owner, habla de personas en clave honesta y no debería circular." },
      ],
    },
    {
      emoji: "🎉",
      title: "¡Listo, Scrum Master!",
      body: "Ya viste tu zona de control completa. Recuerda: tu rol no es asignar trabajo, es proteger al equipo de bloqueos y mantener el ritmo. Si los reportes empiezan a llegar y los indicadores se mueven, vas bien. Mucha suerte.",
    },
  ],
  po: [
    {
      emoji: "👔",
      title: "Hola, Product Owner",
      body: "Te voy a llevar 7 paradas por las features que más vas a usar. Si tienes plan Pro o Enterprise, hay análisis IA poderosos esperándote.",
    },
    {
      tab: "board",
      target: '[data-tour="tab-board"]',
      emoji: "📋",
      title: "Tablero: el estado real",
      body: "Cada tarea tiene un cálculo automático de aporte (dificultad × impacto × estratégico). Esto te da una vista honesta de quién genera valor, no quién está más ocupado.",
    },
    {
      tab: "metrics",
      target: '[data-tour="tab-metrics"]',
      emoji: "📊",
      title: "Métricas: tu radar cuantitativo",
      body: [
        { label: "Qué ves", text: "Vista cuantitativa del proyecto: aporte total, # tareas por estado, distribución por persona, dimensiones del aporte, velocidad. Es la lectura más fría, sin narrativa, solo números. Tu radar para detectar señales antes de que se vuelvan problema." },
        { label: "Cómo leerlas en orden", text: "1) Aporte total del periodo (¿generamos valor?). 2) Distribución por persona (¿alguien tiene 50% del aporte? señal de bus factor). 3) Por dimensión (¿es Estratégico o todo Operativo?). 4) Estados (¿muchas en Pendiente? cuello de botella en arranque)." },
        { label: "Diferencia con los reportes IA", text: "Las métricas son LA FOTO; los reportes IA son LA NARRATIVA. Aquí ves 'Pedro: 5 tareas, aporte 24.3'; el reporte mensual dice 'Pedro destaca por trabajo estratégico pero la calidad de cierre baja en sprints con dependencias externas'. Las dos vistas son complementarias, necesitas ambas." },
        { label: "Errores comunes", text: "1) Premiar 'velocidad' sin mirar aporte por tarea, incentiva tareas chicas que inflan número. 2) Mirar solo distribución por persona sin contexto: alguien con poco aporte puede estar haciendo trabajo fundacional (refactor) que paga después. 3) Comparar sprints con calculadoras distintas, si cambiaste pesos, la comparativa miente." },
        { label: "Tip pro (PO)", text: "Define 1-2 métricas que sigues semana a semana (ej. proporción tareas estratégicas vs operativas) y observa la TENDENCIA, no el valor absoluto. Si la proporción de estratégicas baja por 3 sprints seguidos, algo cambió en cómo planeas, momento de retro con el SM." },
      ],
    },
    {
      tab: "okrs",
      target: '[data-tour="tab-okrs"]',
      emoji: "🧭",
      title: "OKRs: tu compromiso del trimestre",
      body: [
        { label: "Qué son", text: "Objective + Key Results. El objetivo es cualitativo y ambicioso ('Lanzar app móvil con tracción real'); los KRs son cuantitativos y medibles ('1000 usuarios beta', 'NPS > 40', 'Crash rate < 1%'). Como PO, los OKRs son TU contrato con la organización: lo que se espera que muevas este cuarto." },
        { label: "Cómo se conectan con tareas", text: "Cada KR tiene fecha inicio/fin. Vinculas tareas a un KR desde el formulario, dropdown filtrado por fecha de creación (los KRs cuya ventana la contiene aparecen arriba). El progreso del KR se calcula automáticamente: % de tareas finalizadas vinculadas." },
        { label: "Cómo escribir buenos KRs", text: "Mal KR: 'Mejorar UX' (cualitativo, sin medida). Buen KR: 'Reducir tiempo de carga del home a < 1.5s en p95'. Regla: si no puedes graficar el KR en un eje numérico, no es un KR. Métrica + meta numérica + ventana de tiempo." },
        { label: "Errores comunes", text: "1) 10 OKRs por trimestre, todo es prioritario, nada lo es. Recomendado: 2-3 OKRs, 3-4 KRs cada uno. 2) KRs que se cumplen solo con tu fuerza (entregar X documento) en vez de outcomes (X subió a tanto). 3) Olvidar vincular tareas, el evolutivo y reportes pierden el hilo de qué empuja qué." },
        { label: "Tip pro (PO)", text: "Al inicio del trimestre, reúnete con el SM y mapea cada KR a las primeras 5-10 tareas concretas que lo empujan. Si no puedes nombrarlas, el KR es demasiado abstracto o no tienes ruta. Estas 'tareas-faro' deberían arrancar en el primer sprint." },
      ],
    },
    {
      tab: "evolution",
      target: '[data-tour="tab-evolution"]',
      emoji: "💎",
      title: "Evolutivo profesional (Pro Power+)",
      body: [
        { label: "Qué es", text: "Cada 60 días generas un reporte individual por persona: una 'tarjeta profesional' con análisis de 4 capas. Cifras (aporte total, tareas, KRs empujados, dimensiones donde brilla), sentimiento (cómo se sintió según retros y comentarios), contexto causal (qué bloqueos enfrentó), y reconocimiento social (cómo lo ven sus compañeros vía señalizaciones anónimas)." },
        { label: "Por qué cada 60 días", text: "Dos razones. Una: 60 días es la ventana mínima para detectar tendencias reales (un solo sprint malo es ruido). Dos: el modelo es Opus 4.7 ($5/$25 por 1M tokens) y cada generación cuesta ~$0.34/proyecto. Generar mensualmente cuadruplica costo sin entregar más insight. El gating de 60 días lo enforza la DB." },
        { label: "Qué información usa", text: "Tareas del periodo + comentarios + reportes mensuales + retros (señalizaciones anónimas) + perfiles. Si las tareas no tienen comentarios o las retros no se responden, el evolutivo es más pobre, la riqueza depende de la captura del día a día. Sin bitácora, no hay narrativa." },
        { label: "Cómo usarlo en 1:1s", text: "Llega con la tarjeta de la persona. Empieza por SENTIMIENTO ('Veo que te sentiste 😟 los últimos 2 sprints, cuéntame'). Sigue con RECONOCIMIENTO ('Tus compañeros te marcaron guerrero estratégico,¿qué crees que vieron?'). Termina con CIFRAS solo si toca conversación de desempeño. NO uses las tarjetas para evaluar; úsalas para preguntar." },
        { label: "Errores comunes", text: "1) Compartir la tarjeta CON la persona, fue construida para tu lectura, no la suya; comparte conclusiones, no la fuente. 2) Confrontar con cifras antes de explorar contexto. 3) Tratar el evolutivo como performance review, es una foto bimensual, no veredicto." },
        { label: "Tip pro", text: "Después de generar el evolutivo, agenda 1:1 con las 2-3 personas que más CAMBIARON (creció Pedro, cayó Diego, despertó Marcela). El evolutivo es más valioso para detectar cambio que para evaluar estado absoluto." },
      ],
    },
    {
      tab: "chat",
      target: '[data-tour="tab-chat"]',
      emoji: "💬",
      title: "Chat IA: tu consultor de talento en vivo",
      body: [
        { label: "Qué es", text: "Conversación en lenguaje natural con un modelo Sonnet 4.6 cargado con: tu último evolutivo, tus 2 últimos reportes mensuales, estado actual de tareas, comentarios recientes y descripción del proyecto. Solo Enterprise (350k COP/mes)." },
        { label: "Qué puedes preguntarle", text: "Operativo: '¿Quién tiene más carga ahora?', '¿Por qué Diego se atrasa?', '¿Qué tareas llevan >5 días bloqueadas?'. Estratégico: 'Arma una célula de 3 personas para un proyecto de pagos', 'Quién encajaría como tech lead'. Responde con evidencia (cita IDs de tareas, comentarios)." },
        { label: "Qué NO responde", text: "Está protegido para hablar SOLO de tu proyecto y tu equipo. Cultura general, historia, recetas, política, deportes, código no relacionado → te redirige con mensaje fijo. No es ChatGPT, es un consultor especializado en TU contexto. Esto evita 'fuga' del recurso pago a casos ajenos." },
        { label: "Cuota: 100 mensajes/mes/proyecto", text: "Cada pregunta tuya cuenta 1 mensaje. La cuota se renueva el 1 del mes. Cuando quedan ≤10 ves aviso debajo del input. Al llegar a 0, el input se bloquea hasta el próximo mes. Esto controla el costo (sin tope sería cheque en blanco contra Anthropic, $0.05+ por mensaje) y disciplina el uso." },
        { label: "Errores comunes", text: "1) Usar el chat para 'preguntar al aire', gastas cuota en cosas que un grep en tu lista resuelve. 2) Pedir información fuera de su contexto (no sabe cosas pasadas el último evolutivo). 3) Esperar consejo de cosas íntimas del equipo, el chat ve datos, no relaciones humanas." },
        { label: "Tip pro", text: "Antes de cada planning o 1:1, gasta 2-3 mensajes preguntando '¿qué patrón nuevo ves desde el último evolutivo?' o '¿quién aparece como riesgo?'. Llegas a la reunión con hipótesis, no improvisando. Es el caso de uso donde más rinde la cuota." },
      ],
    },
    {
      tab: "pulse",
      target: '[data-tour="tab-pulse"]',
      emoji: "🌡",
      title: "Pulso del equipo: voz cruda después del sprint",
      body: [
        { label: "Qué es", text: "Al cerrar un sprint, cada participante recibe una mini-retro de 5 minutos: 1 emoji + 2 párrafos (gustó/no gustó) + 3 señalizaciones anónimas (guerrero estratégico / podría dar más / la pasó difícil). 7 días para responder. Esta tab te muestra el agregado." },
        { label: "Anonimato real, no cosmético", text: "La identidad de quién envió cada señal es invisible en tu vista. Ves agregados: 'Laura recibió 5 votos como guerrera estratégica' pero nunca 'Pedro votó por Laura'. La DB sí guarda atribución (para evitar duplicados) pero el frontend del PO y los reportes solo exponen conteos." },
        { label: "Qué hacer con cada señal", text: "Guerrero estratégico (4+ votos): reconócelo público en standup. Podría dar más (3+ votos): explora si es asignación mala o desmotivación,1:1 contigo o con el SM. La pasó difícil (3+ votos): URGENTE 1:1, no esperes al siguiente sprint. Emoji bajo (3+ 😴/😡): conversación con el SM sobre carga o claridad de objetivos." },
        { label: "Cómo entra al evolutivo", text: "Los textos gustó/no-gustó alimentan el análisis de sentimiento del evolutivo bimensual. Las señalizaciones aparecen como 'reconocimiento social' en cada tarjeta. Sin retros respondidas, el evolutivo pierde la capa más humana, se vuelve solo cifras." },
        { label: "Errores comunes", text: "1) Confrontar con la señalización ('apareces como could_give_more'), rompes el anonimato implícito y la próxima retro nadie es honesto. 2) Ignorar pulso bajo asumiendo queja temporal. 3) Tratar señalizaciones como votos democráticos sobre desempeño, son indicadores, no veredictos." },
        { label: "Tip pro (PO)", text: "Mira la EVOLUCIÓN entre sprints. Lo importante no es 'Pedro tuvo 3 could_give_more este sprint', sino 'Pedro lleva 3 sprints consecutivos con could_give_more creciente'. Patrón > foto." },
      ],
    },
    {
      tab: "config",
      target: '[data-tour="tab-config"]',
      emoji: "⚙️",
      title: "Configuración: tu cuarto de máquinas",
      body: "Aquí defines cómo se mide y se comunica el proyecto: invitas gente, ajustas la calculadora de aporte, conectas indicadores con tareas y eliges qué reportes IA salen y a quién. Lo que decidas aquí impacta cada métrica de tu radar.",
    },
    {
      tab: "config",
      target: '[data-tour="config-project"]',
      emoji: "🏗️",
      title: "Proyecto + invitar al equipo",
      body: "Datos básicos del proyecto. Aquí también está el campo para invitar gente por email (envía un correo con código de 6 dígitos) y el código de invitación general que puedes compartir por Slack/WhatsApp para que se unan más rápido.",
    },
    {
      tab: "config",
      target: '[data-tour="config-people"]',
      emoji: "👥",
      title: "Participantes",
      body: "Quien está dentro del proyecto. Cuando creas una tarea, su 'Responsable' sale de esta lista. Puedes marcar a alguien como super-usuario si quieres que tenga permisos especiales.",
    },
    {
      tab: "config",
      target: '[data-tour="config-indicators"]',
      emoji: "📊",
      title: "Indicadores clave: KPIs vivos del proyecto",
      body: [
        { label: "Qué son", text: "Métricas medibles que definen si el proyecto va bien. Ejemplos típicos: NPS, conversión, tiempo de carga p95, # bugs en producción, retención semanal. No confundir con OKRs: los OKRs son el destino del trimestre, los indicadores son las señales operativas que sigues semana a semana." },
        { label: "Cómo se conectan con las tareas", text: "Cada tarea puede etiquetarse con uno o varios indicadores que impacta. Cuando una tarea finaliza, su aporte se atribuye a esos indicadores en los reportes. El semanal y el mensual segmentan por indicador: '12 tareas finalizadas impactaron NPS este mes'." },
        { label: "Diferencia con OKRs", text: "OKR = compromiso del trimestre con meta y deadline ('NPS > 40 en Q2'). Indicador = métrica continua que sigues siempre ('NPS', sin meta específica). Un indicador puede tener varios OKRs a lo largo del año; un OKR es un esfuerzo concreto de mover ese indicador." },
        { label: "Errores comunes", text: "1) Crear 20 indicadores, el equipo no etiqueta porque no encuentra cuál aplica. 2) Indicadores demasiado generales ('Calidad') vs. específicos ('Crash-free sessions %'). Específico gana. 3) No mantenerlos: indicador que ya nadie mide debería borrarse o el reporte miente." },
        { label: "Tip pro (PO)", text: "Empieza con 3-5 indicadores que el equipo entiende y puede ver moverse en una semana. Si necesitas más, agrégalos cuando aparezca la necesidad real, no preventivamente. Revisa la lista cada quarter: ¿siguen siendo los que importan? Quita los que no." },
      ],
    },
    {
      tab: "config",
      target: '[data-tour="config-types"]',
      emoji: "🧩",
      title: "Tipos de tarea",
      body: "Categorías por defecto: Estratégica, Operativa, Técnica, Diseño, etc. Tu evolutivo bimensual segmenta por tipo para detectar gente atascada en operativo cuando deberían estar en estratégico. Personalízalos a tu industria.",
    },
    {
      tab: "config",
      target: '[data-tour="config-calculator"]',
      emoji: "⚖️",
      title: "Calculadora de Aporte (el motor del proyecto)",
      body: [
        { label: "Qué es", text: "Una fórmula para valorar cada tarea con un solo número: el Valor de Aporte. Suma ponderada de dimensiones que TÚ defines. Vienen 3 por defecto (Tiempo, Dificultad, Impacto Estratégico) pero puedes AGREGAR cuantas necesites, riesgo regulatorio, impacto en cliente, alineación con OKR, complejidad técnica, o QUITAR las que no apliquen. La calculadora se adapta a tu industria, no al revés." },
        { label: "Cómo funciona el cálculo", text: "Cada dimensión tiene un peso 1-100; idealmente la suma de pesos da 100. Cada tarea recibe un valor 1-10 por dimensión. Aporte = suma(valor × peso) / 100. Ejemplo concreto: con pesos Tiempo=30, Dificultad=30, Estratégico=40, una tarea con valores 7/8/10 vale (7×30 + 8×30 + 10×40)/100 = 8.5 puntos. Otra trivial 3/2/4 = 3.1 puntos. Ese gap es lo que tu radar de métricas y tu evolutivo van a explotar." },
        { label: "Qué pasa con las tareas viejas cuando cambias pesos", text: "Detalle CRÍTICO que la gente entiende mal: cada tarea guarda su aporte calculado al crearla o editarla (un snapshot congelado). Cambiar los pesos NO recalcula el histórico, las tareas viejas quedan con la fórmula vieja, las nuevas con la nueva. Resultado: tu reporte mensual va a comparar peras (mes pasado, pesos viejos) con manzanas (este mes, pesos nuevos). La comparativa entre periodos se rompe. Si necesitas la nueva fórmula en lo viejo, hay que re-editar cada tarea manualmente." },
        { label: "Errores comunes", text: "1) Poner todos los pesos en 100 pensando 'todo es importante', pierde poder de jerarquización. 2) Definir 10 dimensiones, el equipo no las llena, dejan valor default 5 y la calculadora se vuelve ruido sin diferenciación. 3) Cambiar pesos a mitad de proyecto buscando 'mejorar la fórmula', rompes la comparativa de tu propio reporte mensual y el evolutivo bimensual pierde su línea base." },
        { label: "Tip pro (PO)", text: "Define los pesos en el kick-off CON el equipo (no en privado), déjalos quietos durante el proyecto y revísalos UNA VEZ por cuarto si la estrategia cambia. Si necesitas medir algo nuevo, AGREGAR una dimensión nueva rompe menos que reasignar pesos viejos, las tareas viejas se quedan con valor default 5 en la nueva dimensión y la diferencia se diluye en el promedio. Si decides recalcular el histórico, planéalo: avisa al equipo, hazlo en una semana de pocas tareas y verifica el impacto en las personas con más tareas finalizadas." },
      ],
    },
    {
      tab: "config",
      target: '[data-tour="config-fields"]',
      emoji: "🧬",
      title: "Campos personalizados de la tarjeta",
      body: "Si tu proyecto necesita capturar datos extras en cada tarea (presupuesto, riesgo, link externo, owner secundario), créalos aquí. Soportan texto, fecha, select, multiselect y subitems. Marca 'mostrar en tarjeta' para que aparezcan en el board. Borrar un campo conserva los datos históricos.",
    },
    {
      tab: "config",
      target: '[data-tour="config-reports"]',
      emoji: "📬",
      title: "Reportes IA: tus dos lecturas religiosas",
      body: [
        { label: "Qué son", text: "Tres reportes generados por IA y enviados por correo en fechas configuradas. Sin envío manual, solo automático para mantener cadencia y evitar inflar el costo. Como PO, dos son TUS lecturas obligatorias (Semanal + Mensual) y el Scrum es solo de contexto." },
        { label: "Reporte Scrum (bi-semanal)", text: "Para el equipo técnico, no para ti. Tareas atascadas, alertas, próximas a vencer. Hasta 2 días/semana configurables. Gemini Flash. Puedes desactivarlo en TU correo y dejarlo solo para el equipo si no quieres ruido." },
        { label: "Reporte Semanal del PO (lunes 8am)", text: "TU reporte. Narrativa ejecutiva con análisis por persona, recomendaciones, balance de tipos de tarea. Modelo Sonnet 4.6. Llega los lunes 8am, léelo antes de planning. Es como si un consultor te dejara un brief sobre la mesa cada lunes." },
        { label: "Análisis Mensual del Equipo (1er lunes del mes)", text: "TU lectura más profunda. PRIVADO, solo owner. Ejes del equipo, vende-humo, lentos, repetitivos, comparativa con meses anteriores. NO compartas este reporte, está escrito asumiendo que tú eres quien decide. Sonnet 4.6 con caching. Costo ≈ $0.12/mes." },
        { label: "Errores comunes", text: "1) Reenviar el mensual al equipo, está escrito en clave honesta sobre personas, no para circular. 2) No leer el semanal y solo basarse en standups, pierdes patrones que tu memoria no captura. 3) Saturar destinatarios, mantén ≤3 por reporte para que se respete." },
        { label: "Tip pro", text: "Bloquea 30 minutos cada lunes para leer el semanal antes de cualquier otra reunión. Bloquea 1 hora el primer lunes del mes para el mensual. Estos dos hábitos solos justifican el costo del plan Pro Power." },
      ],
    },
    {
      emoji: "🎉",
      title: "¡Listo, PO!",
      body: "Tip final: los reportes IA salen automáticamente (semanal lunes 8am, mensual primer lunes del mes). Léelos como si te los dictara un consultor, están construidos para eso. Y revisa la Calculadora UNA VEZ al inicio: estabilidad ahí = confianza del equipo.",
    },
  ],
  participant: [
    {
      emoji: "💪",
      title: "Hola, equipo",
      body: "Tu día arranca aquí. Te muestro las 5 cosas que necesitas saber para fluir sin fricción.",
    },
    {
      tab: "focus",
      target: '[data-tour="tab-focus"]',
      emoji: "☀️",
      title: "Mi Día: tu base de operaciones",
      body: "Aquí ves SOLO lo tuyo, ordenado por prioridad. Es donde empieza tu día. Si está vacío, pídele al PO o al SM que te asignen.",
    },
    {
      emoji: "✅",
      title: "Estados de tarea: tu lenguaje con el equipo",
      body: [
        { label: "Qué son", text: "Cada tarea pasa por 4 estados: Pendiente (no has empezado) → En proceso (la trabajas hoy) → En revisión (terminaste técnicamente pero esperas validación, code review o QA) → Finalizada (cerrada definitivamente). Los cambias tú directamente en el tablero." },
        { label: "Por qué importa actualizarlos en tiempo real", text: "El reporte Scrum bi-semanal lee estos estados para detectar tareas atascadas ('lleva 5 días en En proceso'). El pulso del equipo y el evolutivo también los leen. Si dejas todo en Pendiente y al final del sprint mueves a Finalizada, los reportes no entienden tu ritmo y tu trabajo aparece distorsionado." },
        { label: "Cuándo mover a cada estado", text: "Pendiente → En proceso: cuando ABRES la tarea esa mañana, no cuando terminas otra. En proceso → En revisión: cuando lo que tienes que entregar está hecho y espera input externo (PR pendiente, demo agendada). En revisión → Finalizada: cuando se aprobó/mergió/entregó. NO te quedes en 'En revisión' después del cierre real, esconde tu trabajo." },
        { label: "Errores comunes", text: "1) 'No actualizo hasta tener algo que mostrar', el reporte Scrum cree que estás atascado. 2) Mover a Finalizada antes de tiempo para 'verse productivo', el SM lo nota cuando los reportes la citan y tú no puedes defenderla. 3) Saltarse 'En revisión' yendo directo a Finalizada, los reportes pierden la señal de 'esperando validación'." },
        { label: "Tip pro", text: "Toma 60 segundos al final del día para revisar tus tareas y mover estados. Es la inversión más alta de productividad: para ti (visibilidad de qué hiciste hoy) y para el equipo (los reportes y standup arrancan con data real)." },
      ],
    },
    {
      emoji: "💬",
      title: "Comentarios = tu bitácora invisible",
      body: [
        { label: "Qué son", text: "Cada tarea tiene un hilo de comentarios. NO son chat ni Slack, son tu bitácora profesional permanente: notas de avance, decisiones tomadas, bloqueos enfrentados, contexto que el código no captura. Quedan asociados a la tarea para siempre, incluso después de cerrada." },
        { label: "Por qué son ORO (literal)", text: "Los reportes IA leen tus comentarios para entender QUÉ hiciste y POR QUÉ. El evolutivo bimensual los usa para detectar tu sentimiento, los bloqueos, las decisiones que tomas. Sin comentarios, los reportes solo ven 'finalizó 5 tareas', invisibilizan TODO tu trabajo de pensamiento, investigación y decisión." },
        { label: "Cuándo comentar", text: "1) Al iniciar: '¿Qué entendí del alcance?'. 2) Al avanzar significativamente: '¿Qué encontré? ¿Qué decidí?'. 3) Al bloquearme: '¿Por qué estoy esperando?'. 4) Al cerrar: 'Cómo quedó, qué probé, riesgos restantes'. Si una tarea cierra sin 3+ comentarios significativos, probablemente la pasaste invisible." },
        { label: "Errores comunes", text: "1) Usar comentarios como Slack para coordinar, ese es otro canal; el comentario es bitácora, no conversación efímera. 2) Comentarios genéricos ('avanzando bien'), no aportan a tu narrativa. 3) Esperar al fin de semana para 'ponerme al día con comentarios', pierdes el contexto vivo." },
        { label: "Tip pro", text: "Cada vez que termines un bloque de trabajo (45-60 min), pega 2-3 líneas en el comentario: qué exploraste, qué decidiste, qué falta. Este hábito convierte tu trabajo invisible en una bitácora que el evolutivo va a brillar, y que tú vas a usar como portafolio cuando cambies de proyecto o empleo." },
      ],
    },
    {
      tab: "board",
      target: '[data-tour="tab-board"]',
      emoji: "📋",
      title: "Tablero general (opcional)",
      body: "Si quieres ver qué hace el resto del equipo, aquí está todo. Útil para entender dependencias o saber a quién pedirle ayuda.",
    },
    {
      emoji: "📝",
      title: "Retrospectiva: 5 minutos honestos al cerrar sprint",
      body: [
        { label: "Qué te llega", text: "Cuando el SM cierra un sprint, recibes un banner en 'Mi día' + un correo. Tienes 7 días para responder. La retro toma 5 minutos: 1 emoji (cómo te sentiste), 2 párrafos cortos (qué te gustó / qué no), y 3 señalizaciones anónimas a compañeros." },
        { label: "Las 3 señalizaciones", text: "Eliges UN compañero para cada categoría: 'aportó estratégicamente' (alguien que destacó por calidad de trabajo), 'podría dar más' (alguien que crees no rindió al máximo de su potencial), 'la pasó difícil' (alguien que viste con sobrecarga o bloqueos). Solo 3 nombres, no un ranking, fuerza priorización." },
        { label: "Cómo se ven en el lado del PO/SM", text: "El PO ve agregados: 'Laura recibió 5 votos como guerrera estratégica'. NUNCA ve quién mandó qué voto. La identidad se guarda en la DB solo para evitar duplicados, pero el frontend del PO y los reportes solo muestran conteos. El SM ve lo mismo si tiene acceso al Pulso." },
        { label: "Por qué responder honesto importa", text: "Tus respuestas alimentan el evolutivo bimensual. Las personas reconocidas como guerreros estratégicos en varias retros consecutivas reciben reconocimiento; las marcadas 'could_give_more' en patrón aparecen como subutilizadas o desalineadas en su tarjeta. La calidad del análisis depende 100% de tu honestidad." },
        { label: "Errores comunes", text: "1) Responder rápido sin pensar y poner los mismos 3 nombres siempre, el patrón se nota y diluye la señal. 2) 'No quiero quemar a Pedro', si no señalas could_give_more cuando aplica, el sistema cree que todo va bien con él. 3) Saltarse retros, el evolutivo de ese ciclo pierde la voz de tu sprint." },
        { label: "Tip pro", text: "Antes de responder, tómate 1 minuto para repasar mentalmente las tareas del sprint: ¿quién destacó realmente? ¿con quién no pude colaborar bien? Las 3 señalizaciones son tu voz al PO y al SM, úsalas con conciencia." },
      ],
    },
    {
      emoji: "🎉",
      title: "¡Eso es todo!",
      body: "Si te trabas en algo: comenta en la tarea con un @ a quien pueda ayudarte. El Scrum Master verá la alerta. Bienvenido al equipo.",
    },
  ],
};

// ─── Componente principal ───────────────────────────────────
// enabled=false pausa el modal y el tour. Útil mientras la pantalla
// de "Elegir proyecto" está visible o durante el spinner de carga.
//
// El rol se lee de project_members.role (vía RPC my_role_in_project) para
// el projectId actual. Owner=PO por defecto; los invitados llegan como
// 'participant'. Cambios de rol los hace el owner desde Configuración
// (esto resetea el progreso del tour vía set_project_member_role).
//
// Estado del tour (current_step, completed_at) sigue siendo global por
// usuario en user_onboarding, switch entre proyectos con roles distintos
// NO replaya el tour automáticamente; el usuario lo lanza con "🎓 Tour".
export default function Onboarding({ supabase, authUser, activeTab, setActiveTab, forceOpen, forceRole = null, onForceHandled, enabled = true, projectId, isOwner = false }) {
  const [state, setState] = useState(null);
  const [role, setRole] = useState(null);  // de project_members
  const [shouldShowTour, setShouldShowTour] = useState(false);
  // Rol que se está mostrando en el tour. Para el tour automático es el rol
  // efectivo del usuario; con el selector ("ver otro onboarding") puede ser
  // cualquiera de los 3 roles aunque no sea el del usuario.
  const [viewRole, setViewRole] = useState(null);

  // El creador del tablero (owner) no siempre tiene rol explícito en
  // project_members: se le trata como PO.
  const effectiveRole = role || (isOwner ? "po" : null);
  const showTour = enabled && shouldShowTour && !!viewRole && !!TOUR_SCRIPTS[viewRole];

  // Carga estado global (current_step, completed_at) + role del proyecto actual.
  useEffect(() => {
    if (!authUser?.id || !supabase || !projectId) return;
    let cancelled = false;
    (async () => {
      const [{ data: onboardData }, { data: roleData }] = await Promise.all([
        supabase.from("user_onboarding").select("*").eq("user_id", authUser.id).maybeSingle(),
        supabase.rpc("my_role_in_project", { p_project_id: projectId }),
      ]);
      if (cancelled) return;

      const r = (typeof roleData === "string") ? roleData : null;
      setRole(r);
      const eff = r || (isOwner ? "po" : null);

      if (!onboardData) {
        setState({ current_step: 0, completed_at: null, skipped: false });
        if (eff && TOUR_SCRIPTS[eff]) { setViewRole(eff); setShouldShowTour(true); }
      } else {
        setState(onboardData);
        if (!onboardData.completed_at && !onboardData.skipped && eff && TOUR_SCRIPTS[eff]) {
          setViewRole(eff); setShouldShowTour(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [authUser?.id, projectId, isOwner]);

  // Soporte para "Volver a ver tour" / "ver otro onboarding" desde el header.
  // forceRole permite ver el tour de cualquier rol; si no se pasa, usa el rol
  // efectivo del usuario.
  useEffect(() => {
    if (!forceOpen) return;
    const target = (forceRole && TOUR_SCRIPTS[forceRole]) ? forceRole : effectiveRole;
    if (target && TOUR_SCRIPTS[target]) {
      setViewRole(target);
      patch({ current_step: 0, completed_at: null, skipped: false });
      setShouldShowTour(true);
    }
    onForceHandled?.();
  }, [forceOpen]);

  const patch = async (changes) => {
    setState(prev => ({ ...(prev || {}), ...changes }));
    if (!authUser?.id || !supabase) return;
    await supabase.from("user_onboarding").upsert({ user_id: authUser.id, ...changes }, { onConflict: "user_id" });
  };

  const skipOnboarding = async () => {
    await patch({ skipped: true });
    setShouldShowTour(false);
  };

  const finishTour = async () => {
    await patch({ completed_at: new Date().toISOString(), skipped: false });
    setShouldShowTour(false);
  };

  const setStep = async (n) => {
    await patch({ current_step: Math.max(0, n) });
  };

  if (!authUser) return null;

  return (
    <>
      {showTour && (
        <TourOverlay
          role={viewRole}
          script={TOUR_SCRIPTS[viewRole]}
          step={state?.current_step ?? 0}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onNext={() => {
            const next = (state?.current_step ?? 0) + 1;
            if (next >= TOUR_SCRIPTS[viewRole].length) finishTour();
            else setStep(next);
          }}
          onBack={() => setStep((state?.current_step ?? 0) - 1)}
          onSkip={skipOnboarding}
        />
      )}
    </>
  );
}

// ─── Welcome modal ────────────────────────────────────────────
// ─── Tour overlay con spotlight ─────────────────────────────
function TourOverlay({ role, script, step, activeTab, setActiveTab, onNext, onBack, onSkip }) {
  const current = script[step];
  const r = ROLES[role];
  const [rect, setRect] = useState(null);
  const tooltipRef = useRef(null);

  // Si el paso requiere una tab específica, cámbiala primero.
  useEffect(() => {
    if (current?.tab && current.tab !== activeTab) setActiveTab(current.tab);
  }, [step, current?.tab, activeTab, setActiveTab]);

  // Recalcula posición del target cuando cambia el paso o se hace scroll/resize.
  useLayoutEffect(() => {
    if (!current?.target) { setRect(null); return; }
    let attempts = 0;
    const tryFind = () => {
      const el = document.querySelector(current.target);
      if (el) {
        const r2 = el.getBoundingClientRect();
        setRect({ top: r2.top, left: r2.left, width: r2.width, height: r2.height });
        // Asegura visibilidad
        if (r2.top < 0 || r2.bottom > window.innerHeight) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }
      attempts += 1;
      if (attempts < 10) setTimeout(tryFind, 80);
    };
    tryFind();

    const onScrollOrResize = () => {
      const el = document.querySelector(current.target);
      if (el) {
        const r2 = el.getBoundingClientRect();
        setRect({ top: r2.top, left: r2.left, width: r2.width, height: r2.height });
      }
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [step, current?.target]);

  const isLast = step === script.length - 1;
  const isFirst = step === 0;

  // Posición del tooltip. Width crece a 440 para los pasos densos (body con
  // secciones etiquetadas). Si el contenido es largo, el body interno hace
  // scroll, así que la altura asumida no necesita ser perfecta.
  const isDeep = Array.isArray(current.body);
  let tooltipStyle = {};
  if (rect) {
    const pad = 12;
    const tooltipW = isDeep ? 440 : 360;
    const assumedH = isDeep ? 420 : 240;
    const spaceBelow = window.innerHeight - (rect.top + rect.height);
    const spaceAbove = rect.top;
    const placeBelow = spaceBelow >= assumedH || spaceBelow >= spaceAbove;
    let top = placeBelow ? rect.top + rect.height + pad : Math.max(20, rect.top - assumedH - pad);
    let left = rect.left + rect.width / 2 - tooltipW / 2;
    if (top < 20) top = 20;
    if (top + assumedH > window.innerHeight - 20) top = Math.max(20, window.innerHeight - assumedH - 20);
    left = Math.max(16, Math.min(window.innerWidth - tooltipW - 16, left));
    tooltipStyle = { position: "fixed", top, left, width: tooltipW, maxHeight: `${window.innerHeight - 40}px` };
  } else {
    tooltipStyle = {
      position: "fixed", top: "50%", left: "50%",
      transform: "translate(-50%, -50%)", width: isDeep ? 520 : 460,
      maxHeight: `${window.innerHeight - 60}px`,
    };
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 99998, pointerEvents: "none" }}>
      <style>{`
        @keyframes wpSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes wpPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.4); } 50% { box-shadow: 0 0 0 8px rgba(255,255,255,0); } }
      `}</style>
      {/* Backdrop con 4 paneles cubriendo todo menos el target */}
      {rect ? (
        <>
          <div style={panelStyle(0, 0, "100vw", rect.top)} />
          <div style={panelStyle(0, rect.top, rect.left, rect.height)} />
          <div style={panelStyle(rect.left + rect.width, rect.top, `calc(100vw - ${rect.left + rect.width}px)`, rect.height)} />
          <div style={panelStyle(0, rect.top + rect.height, "100vw", `calc(100vh - ${rect.top + rect.height}px)`)} />
          {/* Borde brillante alrededor del target */}
          <div style={{
            position: "fixed",
            top: rect.top - 4, left: rect.left - 4,
            width: rect.width + 8, height: rect.height + 8,
            borderRadius: 10,
            boxShadow: `0 0 0 3px ${r.color}, 0 0 24px ${r.color}`,
            animation: "wpPulse 1.6s ease infinite",
            pointerEvents: "none",
          }} />
        </>
      ) : (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(13,13,26,0.75)",
          backdropFilter: "blur(2px)", pointerEvents: "auto",
        }} />
      )}

      {/* Tooltip */}
      <div ref={tooltipRef} style={{
        ...tooltipStyle,
        background: "#fff", borderRadius: 14, padding: 20,
        boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        pointerEvents: "auto",
        animation: "wpSlideUp 0.3s ease",
        border: `2px solid ${r.color}`,
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: r.gradient, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, flexShrink: 0,
          }}>{current.emoji || r.emoji}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: r.color, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {r.label} · Paso {step + 1} de {script.length}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1e1e3a", lineHeight: 1.3 }}>
              {current.title}
            </div>
          </div>
        </div>

        {/* Body, soporta string simple o array de secciones {label, text} */}
        <div style={{ marginBottom: 16, overflowY: "auto", maxHeight: "55vh", paddingRight: 4 }}>
          {Array.isArray(current.body) ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {current.body.map((sec, i) => (
                typeof sec === "string" ? (
                  <p key={i} style={{ margin: 0, fontSize: 13, color: "#444", lineHeight: 1.55 }}>{sec}</p>
                ) : (
                  <div key={i} style={{ borderLeft: `3px solid ${r.color}`, paddingLeft: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: r.color, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                      {sec.label}
                    </div>
                    <div style={{ fontSize: 13, color: "#444", lineHeight: 1.5 }}>{sec.text}</div>
                  </div>
                )
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13.5, color: "#444", lineHeight: 1.55 }}>{current.body}</p>
          )}
        </div>

        {/* Progress dots */}
        <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 16 }}>
          {script.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 24 : 6, height: 6, borderRadius: 3,
              background: i === step ? r.color : i < step ? `${r.color}80` : "#e0e0e0",
              transition: "all 0.3s",
            }} />
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={onSkip} style={{
            background: "none", border: "none", color: "#999", fontSize: 11,
            cursor: "pointer", textDecoration: "underline", fontFamily: "inherit",
          }}>
            Saltar tour
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {!isFirst && (
              <button onClick={onBack} style={{
                background: "#f4f4f4", border: "none", borderRadius: 8,
                padding: "8px 16px", cursor: "pointer", fontSize: 12, fontWeight: 600,
                color: "#666", fontFamily: "inherit",
              }}>
                ← Anterior
              </button>
            )}
            <button onClick={onNext} style={{
              background: r.gradient, color: "#fff", border: "none", borderRadius: 8,
              padding: "8px 18px", cursor: "pointer", fontSize: 12, fontWeight: 700,
              fontFamily: "inherit",
            }}>
              {isLast ? "Terminar 🎉" : "Siguiente →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function panelStyle(left, top, width, height) {
  return {
    position: "fixed",
    left: typeof left === "number" ? `${left}px` : left,
    top: typeof top === "number" ? `${top}px` : top,
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
    background: "rgba(13,13,26,0.72)",
    backdropFilter: "blur(2px)",
    pointerEvents: "auto",
    transition: "all 0.2s ease",
  };
}
