const { Anthropic } = require("@anthropic-ai/sdk");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildPrompt({ weekStart, weekEnd, tasks }) {
  const total = tasks.length;
  const porEstado = tasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});
  const porResponsable = tasks.reduce((acc, t) => {
    const r = t.responsible || "Sin asignar";
    if (!acc[r]) acc[r] = { total: 0, finalizadas: 0, enProceso: 0, sinIniciar: 0, bloqueadas: 0, aporte: 0, actualizadas: 0 };
    acc[r].total++;
    if (t.status === "Finalizada") acc[r].finalizadas++;
    if (t.status === "En proceso") acc[r].enProceso++;
    if (t.status === "Sin iniciar") acc[r].sinIniciar++;
    if (t.status === "Bloqueada") acc[r].bloqueadas++;
    acc[r].aporte += parseFloat(t.aporte_snapshot || 0);
    if (t.comments && t.comments.trim().length > 0) acc[r].actualizadas++;
    return acc;
  }, {});
  const porIndicador = tasks.reduce((acc, t) => {
    const ind = t.indicator || "Sin indicador";
    if (!acc[ind]) acc[ind] = { total: 0, finalizadas: 0, enProceso: 0, aporte: 0 };
    acc[ind].total++;
    if (t.status === "Finalizada") acc[ind].finalizadas++;
    if (t.status === "En proceso") acc[ind].enProceso++;
    acc[ind].aporte += parseFloat(t.aporte_snapshot || 0);
    return acc;
  }, {});
  const hoy = new Date();
  const tareasRetrasadas = tasks.filter(t => {
    if (!t.endDate && !t.end_date) return false;
    const fin = new Date(t.endDate || t.end_date);
    return fin < hoy && t.status !== "Finalizada" && t.status !== "Cancelada";
  });
  const tareasEnRiesgo = tasks.filter(t => {
    if (!t.endDate && !t.end_date) return false;
    const fin = new Date(t.endDate || t.end_date);
    const diff = (fin - hoy) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 5 && t.status !== "Finalizada" && t.status !== "Cancelada";
  });
  const progresoPromedio = tasks.length > 0
    ? (tasks.reduce((s, t) => s + parseFloat(t.progress_percent || 0), 0) / tasks.length).toFixed(1)
    : 0;
  const aporteTotal = tasks.reduce((s, t) => s + parseFloat(t.aporte_snapshot || 0), 0).toFixed(1);

  const resumenEstados = Object.entries(porEstado).map(([k, v]) => `${k}: ${v}`).join(", ");
  const detalleResponsables = Object.entries(porResponsable).map(([nombre, d]) =>
    `- ${nombre}: ${d.total} tareas (${d.finalizadas} finalizadas, ${d.enProceso} en proceso, ${d.bloqueadas} bloqueadas) | Aporte acumulado: ${d.aporte.toFixed(1)} | Tareas con comentarios/actualizaciones: ${d.actualizadas}`
  ).join("\n");
  const detalleIndicadores = Object.entries(porIndicador).map(([ind, d]) =>
    `- ${ind}: ${d.total} tareas | ${d.finalizadas} finalizadas | ${d.enProceso} en proceso | Aporte total: ${d.aporte.toFixed(1)}`
  ).join("\n");
  const detalleRetrasadas = tareasRetrasadas.map(t =>
    `- #${t.id} "${t.title}" | Responsable: ${t.responsible || "Sin asignar"} | Venció: ${t.endDate || t.end_date} | Estado: ${t.status} | Progreso: ${t.progress_percent || 0}%`
  ).join("\n") || "Ninguna";
  const detalleRiesgo = tareasEnRiesgo.map(t =>
    `- #${t.id} "${t.title}" | Responsable: ${t.responsible || "Sin asignar"} | Vence: ${t.endDate || t.end_date} | Progreso: ${t.progress_percent || 0}%`
  ).join("\n") || "Ninguna";
  const detalleTareas = tasks.map((t, i) =>
    `${i + 1}. [#${t.id}] ${t.title || "(sin título)"}
   Estado: ${t.status || "Sin iniciar"} | Responsable: ${t.responsible || "No asignado"} | Progreso: ${t.progress_percent || 0}% | Aporte: ${t.aporte_snapshot || 0}
   Indicador: ${t.indicator || "Sin indicador"} | Tipo: ${t.type || ""} | Dificultad: ${t.difficulty || ""}/10 | Valor estratégico: ${t.strategic_value || ""}/10
   Fecha inicio: ${t.startDate || t.start_date || "N/A"} | Fecha fin: ${t.endDate || t.end_date || "N/A"}
   Subtareas: ${Array.isArray(t.subtasks) ? t.subtasks.length + " (" + t.subtasks.filter(s => s.done).length + " completadas)" : "ninguna"}
   Comentarios: ${t.comments || "Sin comentarios"}`
  ).join("\n\n");

  return `Eres un consultor ejecutivo senior especializado en análisis de gestión de proyectos y productividad de equipos.
Tu análisis debe ser PROFUNDO, CRÍTICO y ORIENTADO A LA ACCIÓN. No repitas datos, interprétalos.
Identifica patrones, riesgos reales, personas destacadas y rezagadas, indicadores con momentum y los que están estancados.
Usa lenguaje ejecutivo directo. Sé honesto aunque el diagnóstico sea negativo.

RESPONDE ÚNICAMENTE CON EL HTML COMPLETO. Sin markdown, sin bloques de código, sin texto antes ni después.
Tu respuesta debe comenzar exactamente con <!DOCTYPE html>

DATOS DEL PERIODO: ${weekStart} al ${weekEnd}

═══════════════════════════════════════
MÉTRICAS GLOBALES
═══════════════════════════════════════
Total tareas: ${total}
Estados: ${resumenEstados}
Progreso promedio del equipo: ${progresoPromedio}%
Aporte de valor total acumulado: ${aporteTotal}
Tareas vencidas: ${tareasRetrasadas.length}
Tareas en riesgo (vencen en ≤5 días): ${tareasEnRiesgo.length}

═══════════════════════════════════════
ANÁLISIS POR RESPONSABLE
═══════════════════════════════════════
${detalleResponsables}

═══════════════════════════════════════
ANÁLISIS POR INDICADOR ESTRATÉGICO
═══════════════════════════════════════
${detalleIndicadores}

═══════════════════════════════════════
TAREAS VENCIDAS (REQUIEREN ATENCIÓN INMEDIATA)
═══════════════════════════════════════
${detalleRetrasadas}

═══════════════════════════════════════
TAREAS EN RIESGO (VENCEN EN ≤5 DÍAS)
═══════════════════════════════════════
${detalleRiesgo}

═══════════════════════════════════════
DETALLE COMPLETO DE TAREAS
═══════════════════════════════════════
${detalleTareas}

═══════════════════════════════════════
ESTRUCTURA DEL REPORTE HTML QUE DEBES GENERAR
═══════════════════════════════════════
Genera un reporte HTML ejecutivo completo con estas secciones en orden:

1. ENCABEZADO: Logo textual "Banco W", título "Reporte Ejecutivo Semanal", periodo, fecha de generación.

2. SEMÁFORO EJECUTIVO: 3-4 tarjetas visuales grandes con los KPIs más críticos
   (progreso promedio, tareas vencidas, aporte total, % finalización).
   Usa colores semáforo: verde si está bien, amarillo si hay riesgo, rojo si es crítico.

3. DIAGNÓSTICO EJECUTIVO (150-200 palabras): Tu análisis real de la situación del equipo.
   ¿Hacia dónde va el área? ¿Hay momentum o estancamiento? ¿Cuál es el riesgo principal?
   Sé directo, no adornes. Si hay problemas graves, dilo claramente.

4. RANKING DE PERSONAS:
   - Top performers: quién entrega más valor, más rápido, más actualizado
   - Quién necesita atención: personas con tareas bloqueadas, sin actualizar, rezagadas
   Incluye métricas concretas para cada persona. No pongas a todos igual de bien.

5. INDICADORES ESTRATÉGICOS:
   Tabla visual por indicador mostrando cuántas tareas lo impactan,
   cuántas están finalizadas, el aporte acumulado y una barra de progreso visual.
   Destaca cuál indicador tiene más momentum y cuál está estancado.

6. TAREAS EN SEMÁFORO ROJO: Lista visual de tareas vencidas y en riesgo
   con responsable, días de retraso y estado actual. Formato de alerta visual.

7. TABLA COMPLETA DE TAREAS: Tabla detallada con todas las tareas,
   coloreada por estado, con barra de progreso visual para cada una.

8. RECOMENDACIONES EJECUTIVAS: Máximo 5 acciones concretas y priorizadas
   que el equipo debe tomar ESTA SEMANA. Cada una con responsable sugerido.

9. FOOTER: "Generado por W Planner · Banco W · ${new Date().toLocaleDateString('es-CO')}"

DISEÑO:
- Fondo: #f0f4f8
- Fuente: Segoe UI o Arial
- Colores de estado: Finalizada=#27ae60, En proceso=#2980b9, Sin iniciar=#95a5a6, Bloqueada=#e74c3c, En pausa=#e67e22, Cancelada=#7f8c8d
- Tarjetas con sombra suave, bordes redondeados
- Tablas con thead oscuro #2c3e50, filas alternas
- Barras de progreso CSS puras (no imágenes)
- El reporte debe verse profesional impreso o en pantalla
- Max-width: 1200px centrado`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { weekStart, weekEnd, tasks } = req.body || {};
  if (!weekStart || !weekEnd || !Array.isArray(tasks)) {
    return res.status(400).json({ error: "weekStart, weekEnd y tasks son requeridos" });
  }

  try {
    const prompt = buildPrompt({ weekStart, weekEnd, tasks });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 6000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content?.[0]?.text || "";

    // Extraer HTML puro si viene envuelto en markdown
    const htmlMatch = raw.match(/```html\s*([\s\S]*?)```/i);
    const html = htmlMatch ? htmlMatch[1].trim() : raw.trim();

    if (!html.startsWith("<!DOCTYPE") && !html.startsWith("<html") && !html.startsWith("<HTML")) {
      console.error("[generate-report] Respuesta no es HTML válido:", html.substring(0, 200));
      return res.status(500).json({ error: "El modelo no generó HTML válido. Intenta de nuevo." });
    }

    return res.status(200).json({ html, weekStart, weekEnd, taskCount: tasks.length });
  } catch (error) {
    console.error("[generate-report] Error:", error);
    return res.status(500).json({ error: error.message || "Error generando reporte" });
  }
};
