const { Anthropic } = require("@anthropic-ai/sdk");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildPrompt({ weekStart, weekEnd, tasks, participants, indicators }) {

  // ── Métricas globales ──────────────────────────────────────────
  const total = tasks.length;
  const porEstado = tasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1; return acc;
  }, {});
  const progresoPromedio = total > 0
    ? (tasks.reduce((s, t) => s + parseFloat(t.progress_percent || 0), 0) / total).toFixed(1) : 0;
  const aporteTotal = tasks.reduce((s, t) => s + parseFloat(t.aporte_snapshot || 0), 0).toFixed(1);

  // ── Análisis por responsable ───────────────────────────────────
  const porResponsable = tasks.reduce((acc, t) => {
    const r = t.responsible || "Sin asignar";
    if (!acc[r]) acc[r] = {
      tareas: [], finalizadas: 0, enProceso: 0, sinIniciar: 0,
      bloqueadas: 0, aporteTotal: 0, comentarios: [], entregables: [],
      subtareasTotal: 0, subtareasDone: 0
    };
    acc[r].tareas.push(t);
    if (t.status === "Finalizada") acc[r].finalizadas++;
    if (t.status === "En proceso") acc[r].enProceso++;
    if (t.status === "Sin iniciar") acc[r].sinIniciar++;
    if (t.status === "Bloqueada") acc[r].bloqueadas++;
    acc[r].aporteTotal += parseFloat(t.aporte_snapshot || 0);
    if (t.comments && t.comments.trim()) acc[r].comentarios.push(`[#${t.id} "${t.title}"]: ${t.comments.trim()}`);
    if (t.expectedDelivery && t.expectedDelivery.trim()) acc[r].entregables.push(`[#${t.id} "${t.title}"]: ${t.expectedDelivery.trim()}`);
    if (Array.isArray(t.subtasks)) {
      acc[r].subtareasTotal += t.subtasks.length;
      acc[r].subtareasDone += t.subtasks.filter(s => s.done).length;
    }
    return acc;
  }, {});

  // ── Análisis por indicador ─────────────────────────────────────
  const porIndicador = tasks.reduce((acc, t) => {
    const inds = Array.isArray(t.indicators) && t.indicators.length > 0
      ? t.indicators : [{ name: t.indicator || "Sin indicador", isPrimary: true }];
    inds.forEach(ind => {
      const nombre = typeof ind === "string" ? ind : ind.name;
      if (!acc[nombre]) acc[nombre] = { tareas: [], finalizadas: 0, aporte: 0, responsables: new Set() };
      acc[nombre].tareas.push(t);
      if (t.status === "Finalizada") acc[nombre].finalizadas++;
      acc[nombre].aporte += parseFloat(t.aporte_snapshot || 0);
      if (t.responsible) acc[nombre].responsables.add(t.responsible);
    });
    return acc;
  }, {});

  // ── Tareas vencidas y en riesgo ────────────────────────────────
  const hoy = new Date();
  const vencidas = tasks.filter(t => {
    const fin = t.endDate || t.end_date;
    return fin && new Date(fin) < hoy && t.status !== "Finalizada" && t.status !== "Cancelada";
  });
  const enRiesgo = tasks.filter(t => {
    const fin = t.endDate || t.end_date;
    if (!fin) return false;
    const diff = (new Date(fin) - hoy) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 5 && t.status !== "Finalizada" && t.status !== "Cancelada";
  });

  // ── Correlaciones temáticas (títulos + comentarios + entregables) ──
  const todosLosTextos = tasks.map(t =>
    `#${t.id} | Título: ${t.title} | Indicador: ${t.indicator || "N/A"} | Responsable: ${t.responsible || "N/A"} | Estado: ${t.status} | Progreso: ${t.progress_percent || 0}% | Aporte: ${t.aporte_snapshot || 0} | Dificultad: ${t.difficulty || "N/A"}/10 | Valor estratégico: ${t.strategic_value || "N/A"}/10 | Tipo: ${t.type || "N/A"} | Fecha inicio: ${t.startDate || t.start_date || "N/A"} | Fecha fin: ${t.endDate || t.end_date || "N/A"} | Entregable comprometido: ${t.expectedDelivery || "No definido"} | Comentarios: ${t.comments || "Sin comentarios"} | Subtareas: ${Array.isArray(t.subtasks) ? t.subtasks.map(s => (s.done ? "[✓]" : "[ ]") + " " + s.text).join(", ") : "ninguna"}`
  ).join("\n");

  const detalleResponsables = Object.entries(porResponsable).map(([nombre, d]) => `
PERSONA: ${nombre}
  Tareas totales: ${d.tareas.length} | Finalizadas: ${d.finalizadas} | En proceso: ${d.enProceso} | Sin iniciar: ${d.sinIniciar} | Bloqueadas: ${d.bloqueadas}
  Aporte de valor acumulado: ${d.aporteTotal.toFixed(1)}
  Subtareas: ${d.subtareasDone}/${d.subtareasTotal} completadas
  ENTREGABLES COMPROMETIDOS:
${d.entregables.length > 0 ? d.entregables.map(e => "    " + e).join("\n") : "    (ninguno definido)"}
  COMENTARIOS Y ACTUALIZACIONES:
${d.comentarios.length > 0 ? d.comentarios.map(c => "    " + c).join("\n") : "    (sin comentarios en el periodo)"}`
  ).join("\n\n");

  const detalleIndicadores = Object.entries(porIndicador).map(([nombre, d]) =>
    `INDICADOR: ${nombre} | Tareas: ${d.tareas.length} | Finalizadas: ${d.finalizadas} | Aporte total: ${d.aporte.toFixed(1)} | Personas involucradas: ${[...d.responsables].join(", ") || "N/A"}`
  ).join("\n");

  const detalleVencidas = vencidas.map(t =>
    `#${t.id} "${t.title}" | Resp: ${t.responsible || "N/A"} | Venció: ${t.endDate || t.end_date} | Estado: ${t.status} | Progreso: ${t.progress_percent || 0}% | Entregable: ${t.expectedDelivery || "no definido"}`
  ).join("\n") || "Ninguna";

  const detalleRiesgo = enRiesgo.map(t => {
    const dias = Math.ceil((new Date(t.endDate || t.end_date) - hoy) / (1000 * 60 * 60 * 24));
    return `#${t.id} "${t.title}" | Resp: ${t.responsible || "N/A"} | Vence en ${dias} día(s) | Progreso: ${t.progress_percent || 0}%`;
  }).join("\n") || "Ninguna";

  return `Eres un consultor ejecutivo senior con profunda experiencia en estrategia de marketing, gestión de equipos de alto rendimiento y análisis de productividad.

Tu misión es generar un reporte ejecutivo de ALTO VALOR que vaya mucho más allá de contar tareas. Debes leer cada comentario, cada entregable comprometido, identificar patrones temáticos entre tareas, detectar correlaciones entre el trabajo del equipo y los resultados estratégicos del área.

Analiza como un experto en marketing y estrategia qué iniciativas tendrán mayor impacto a corto plazo, quién está realmente avanzando y quién está rezagado, qué indicadores tienen momentum real y cuáles están estancados.

RESPONDE ÚNICAMENTE CON EL HTML COMPLETO.
Sin markdown, sin bloques de código, sin texto antes ni después.
Tu respuesta debe comenzar exactamente con <!DOCTYPE html>

══════════════════════════════════════════════
DATOS DEL PERIODO: ${weekStart} al ${weekEnd}
══════════════════════════════════════════════

MÉTRICAS GLOBALES:
Total tareas: ${total} | Estados: ${JSON.stringify(porEstado)} | Progreso promedio: ${progresoPromedio}% | Aporte total: ${aporteTotal} | Vencidas: ${vencidas.length} | En riesgo: ${enRiesgo.length}

INDICADORES ESTRATÉGICOS:
${detalleIndicadores}

ANÁLISIS PROFUNDO POR PERSONA (con todos sus comentarios y entregables):
${detalleResponsables}

TAREAS VENCIDAS:
${detalleVencidas}

TAREAS EN RIESGO (≤5 días):
${detalleRiesgo}

TODAS LAS TAREAS CON CONTEXTO COMPLETO:
${todosLosTextos}

══════════════════════════════════════════════
ESTRUCTURA DEL REPORTE HTML QUE DEBES GENERAR
══════════════════════════════════════════════

COLORES INSTITUCIONALES BANCO W:
- Naranja principal: #ef7218
- Agua marina: #0aa0ab
- Blanco: #ffffff
- Gris claro: #f5f5f5
- Gris texto: #444444
- Usa estos colores en headers, badges, bordes destacados y acentos

SECCIONES EN ORDEN:

1. ENCABEZADO INSTITUCIONAL
   - Fondo degradado de #ef7218 a #0aa0ab
   - Texto: "Banco W" grande en blanco + "W Planner · Reporte Ejecutivo Semanal"
   - Periodo y fecha de generación

2. SEMÁFORO EJECUTIVO (4 tarjetas KPI grandes)
   - Progreso promedio del equipo (verde/amarillo/rojo según valor)
   - Tareas vencidas (rojo si > 0)
   - Aporte de valor total acumulado
   - Porcentaje de tareas finalizadas
   Usa #ef7218 o #0aa0ab como color de acento en las tarjetas

3. DIAGNÓSTICO ESTRATÉGICO DEL ÁREA (200-250 palabras)
   Lee TODOS los títulos, comentarios y entregables.
   Identifica: ¿Cuáles son los grandes temas transversales que une al equipo esta semana?
   ¿Hay una campaña, un lanzamiento, un proyecto que conecta múltiples personas?
   ¿Hacia dónde va el área realmente? ¿Hay momentum o dispersión de esfuerzos?
   ¿Cuál es el mayor riesgo estratégico esta semana?
   Sé directo y profundo. No adornes si hay problemas.

4. CORRELACIÓN DE INICIATIVAS
   Agrupa las tareas por temas/proyectos transversales que identifiques
   (no por indicador, sino por correlación real de contenido).
   Ejemplo: "Iniciativa: Campaña Mundial" → qué tareas la componen,
   quiénes trabajan en ella, qué tan avanzada está, qué impacto estratégico tiene.
   Muestra cómo se conectan los esfuerzos individuales para generar valor al área.

5. ANÁLISIS DE INDICADORES ESTRATÉGICOS
   Tabla visual por indicador con: tareas activas, % avance, aporte acumulado,
   personas involucradas, barra de progreso, semáforo de momentum.
   Destaca con #0aa0ab el indicador con más tracción real.
   Identifica cuál indicador está en riesgo de no cumplirse.

6. DESGLOSE INDIVIDUAL POR PERSONA
   Para CADA persona genera una tarjeta con:
   - Nombre destacado con borde izquierdo en #ef7218
   - Métricas: tareas totales, finalizadas, aporte, subtareas completadas
   - Resumen de EN QUÉ ESTÁ TRABAJANDO realmente (basado en títulos + comentarios)
   - QUÉ SE COMPROMETIÓ A ENTREGAR (basado en campo entregable)
   - NIVEL DE ACTUALIZACIÓN: ¿comenta? ¿actualiza progreso? ¿o está en silencio?
   - ANÁLISIS EXPERTO: Como experto en marketing/estrategia, ¿qué de su trabajo
     tendrá mayor impacto a corto plazo? ¿Qué debería priorizar?
   - Badge de rendimiento: "Alto rendimiento" / "En seguimiento" / "Requiere atención"
     usando colores institucionales

7. ALERTAS OPERATIVAS
   Sección visual de alerta con fondo #fff3cd para vencidas y #ffe5e5 para bloqueadas.
   Lista clara de tareas que necesitan acción inmediata esta semana.

8. TABLA COMPLETA DE TAREAS
   Tabla con thead en #0aa0ab (texto blanco), filas alternas gris claro.
   Columnas: #ID, Título, Responsable, Indicador, Estado (badge color),
   Progreso (barra CSS), Entregable comprometido (resumido).
   Ordenada por: vencidas primero, luego en proceso, luego sin iniciar.

9. RECOMENDACIONES EJECUTIVAS DE LA SEMANA
   Exactamente 5 acciones concretas y priorizadas.
   Cada una con: número grande en #ef7218, acción específica, responsable sugerido, urgencia.
   Basadas en el análisis real, no genéricas.

10. FOOTER
    Fondo #0aa0ab, texto blanco.
    "W Planner · Banco W · Generado el ${new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}"

DISEÑO GENERAL:
- Font-family: 'Segoe UI', Arial, sans-serif
- Fondo general: #f5f5f5
- Tarjetas: fondo blanco, border-radius: 12px, box-shadow suave
- Max-width: 1100px centrado con margin auto
- Colores de estado: Finalizada=#27ae60, En proceso=#0aa0ab, Sin iniciar=#95a5a6, Bloqueada=#e74c3c, En pausa=#e67e22, Cancelada=#7f8c8d, No programada=#bdc3c7
- Barras de progreso CSS puras con color #ef7218
- El reporte debe verse ejecutivo, limpio y profesional`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { weekStart, weekEnd, tasks, participants, indicators } = req.body || {};
  if (!weekStart || !weekEnd || !Array.isArray(tasks)) {
    return res.status(400).json({ error: "weekStart, weekEnd y tasks son requeridos" });
  }

  try {
    const prompt = buildPrompt({ weekStart, weekEnd, tasks, participants, indicators });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content?.[0]?.text || "";
    const htmlMatch = raw.match(/```html\s*([\s\S]*?)```/i);
    const html = htmlMatch ? htmlMatch[1].trim() : raw.trim();

    if (!html.startsWith("<!DOCTYPE") && !html.startsWith("<html") && !html.startsWith("<HTML")) {
      console.error("[generate-report] No es HTML válido:", html.substring(0, 300));
      return res.status(500).json({ error: "El modelo no generó HTML válido. Intenta de nuevo." });
    }

    return res.status(200).json({ html, weekStart, weekEnd, taskCount: tasks.length });
  } catch (error) {
    console.error("[generate-report] Error:", error);
    return res.status(500).json({ error: error.message || "Error generando reporte" });
  }
};
