const { Anthropic } = require("@anthropic-ai/sdk");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildPrompt({ weekStart, weekEnd, tasks, participants, indicators }) {

  const total = tasks.length;
  const porEstado = tasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1; return acc;
  }, {});
  const progresoPromedio = total > 0
    ? (tasks.reduce((s, t) => s + parseFloat(t.progress_percent || 0), 0) / total).toFixed(1) : 0;
  const aporteTotal = tasks.reduce((s, t) => s + parseFloat(t.aporte_snapshot || 0), 0).toFixed(1);

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
    if (t.comments && t.comments.trim()) acc[r].comentarios.push(`Tarea #${t.id} "${t.title}": ${t.comments.trim()}`);
    if (t.expectedDelivery && t.expectedDelivery.trim()) acc[r].entregables.push(`Tarea #${t.id} "${t.title}": ${t.expectedDelivery.trim()}`);
    if (Array.isArray(t.subtasks)) {
      acc[r].subtareasTotal += t.subtasks.length;
      acc[r].subtareasDone += t.subtasks.filter(s => s.done).length;
    }
    return acc;
  }, {});

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

  const todosLosTextos = tasks.map(t =>
    `#${t.id} | ${t.title} | ${t.responsible || "N/A"} | ${t.status} | ${t.progress_percent || 0}% | Indicador: ${t.indicator || "N/A"} | Entregable: ${t.expectedDelivery || "no definido"} | Comentarios: ${t.comments || "sin comentarios"} | Subtareas: ${Array.isArray(t.subtasks) ? t.subtasks.map(s => (s.done ? "[✓]" : "[ ]") + s.text).join(", ") : "ninguna"}`
  ).join("\n");

  const detalleResponsables = Object.entries(porResponsable).map(([nombre, d]) => `
PERSONA: ${nombre}
  Tareas: ${d.tareas.length} | Finalizadas: ${d.finalizadas} | En proceso: ${d.enProceso} | Sin iniciar: ${d.sinIniciar} | Bloqueadas: ${d.bloqueadas}
  Aporte acumulado: ${d.aporteTotal.toFixed(1)} | Subtareas: ${d.subtareasDone}/${d.subtareasTotal}
  ENTREGABLES COMPROMETIDOS:
${d.entregables.length > 0 ? d.entregables.map(e => "    - " + e).join("\n") : "    (ninguno definido)"}
  COMENTARIOS DEL PERIODO:
${d.comentarios.length > 0 ? d.comentarios.map(c => "    - " + c).join("\n") : "    (sin comentarios)"}`
  ).join("\n\n");

  const detalleIndicadores = Object.entries(porIndicador).map(([nombre, d]) =>
    `- ${nombre}: ${d.tareas.length} tareas | ${d.finalizadas} finalizadas | Aporte: ${d.aporte.toFixed(1)} | Personas: ${[...d.responsables].join(", ") || "N/A"}`
  ).join("\n");

  const detalleVencidas = vencidas.map(t =>
    `- #${t.id} "${t.title}" | Resp: ${t.responsible || "N/A"} | Venció: ${t.endDate || t.end_date} | Progreso: ${t.progress_percent || 0}%`
  ).join("\n") || "Ninguna";

  const detalleRiesgo = enRiesgo.map(t => {
    const dias = Math.ceil((new Date(t.endDate || t.end_date) - hoy) / (1000 * 60 * 60 * 24));
    return `- #${t.id} "${t.title}" | Resp: ${t.responsible || "N/A"} | Vence en ${dias} día(s) | Progreso: ${t.progress_percent || 0}%`;
  }).join("\n") || "Ninguna";

  return `Eres un consultor ejecutivo senior con experiencia en estrategia de marketing y gestión de equipos de alto rendimiento.

Tu tarea es escribir un reporte ejecutivo semanal en LENGUAJE NATURAL, redactado como una carta ejecutiva de alto nivel dirigida a la dirección de Banco W.

El reporte debe leerse como lo escribiría un consultor experto: fluido, directo, con criterio estratégico. No es una lista de datos. Es un análisis narrativo que interpreta lo que está pasando, identifica patrones, nombra riesgos y da recomendaciones accionables.

Lee TODOS los comentarios y entregables de cada persona. Cruza esa información. Identifica qué grandes iniciativas conectan al equipo. Analiza como experto en marketing qué tiene mayor impacto a corto plazo.

GENERA EL REPORTE COMO HTML DE CORREO ELECTRÓNICO.
El HTML debe ser simple, compatible con Gmail y Outlook.
Sin frameworks, sin CSS externo, todo inline.
Comienza exactamente con <!DOCTYPE html>

DATOS DEL PERIODO: ${weekStart} al ${weekEnd}
Generado: ${new Date().toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}

MÉTRICAS:
Total tareas: ${total} | Estados: ${JSON.stringify(porEstado)} | Progreso promedio: ${progresoPromedio}% | Aporte total: ${aporteTotal} | Vencidas: ${vencidas.length} | En riesgo: ${enRiesgo.length}

INDICADORES:
${detalleIndicadores}

POR PERSONA:
${detalleResponsables}

VENCIDAS:
${detalleVencidas}

EN RIESGO:
${detalleRiesgo}

TODAS LAS TAREAS:
${todosLosTextos}

ESTRUCTURA DEL HTML QUE DEBES GENERAR:

El correo debe tener max-width 700px centrado, fondo blanco,
font-family Arial sans-serif, color de texto #333333.

1. ENCABEZADO
   Bloque con fondo degradado inline de #ef7218 a #0aa0ab, padding 32px, texto centrado blanco.
   Título: "Banco W · Reporte Ejecutivo Semanal" en 28px bold.
   Subtítulo: periodo y fecha en 14px.

2. PULSO DEL EQUIPO (4 cajas en fila, inline-block)
   Cajas simples: borde superior 3px, padding 16px, text-align center, width ~140px.
   - Progreso promedio: borde #0aa0ab
   - Tareas vencidas: borde #e74c3c si >0, sino #27ae60
   - Aporte total: borde #ef7218
   - % Finalizadas: borde según valor
   Número grande (32px) + label pequeño (12px gris).

3. DIAGNÓSTICO NARRATIVO DEL ÁREA
   Título "Diagnóstico de la semana" con línea izquierda 3px #ef7218.
   Redacta 3-4 párrafos en lenguaje natural analizando:
   - Qué grandes temas o iniciativas conectan al equipo (¿hay una campaña, un lanzamiento,
     un proyecto transversal que emerge de leer todas las tareas?)
   - Si el equipo está concentrado o disperso
   - Hacia dónde va el área realmente
   - El mayor riesgo estratégico de la semana
   Escribe como un consultor que conoce el negocio. Directo, sin rodeos.

4. INICIATIVAS TRANSVERSALES
   Título "Iniciativas que mueven el área"
   Identifica 2-4 grandes iniciativas temáticas que emergen de correlacionar las tareas.
   Para cada una escribe un párrafo: qué es, quiénes trabajan en ella,
   qué tan avanzada está y qué impacto estratégico tiene para el banco.
   Usa un punto de color #0aa0ab antes de cada iniciativa.

5. INDICADORES ESTRATÉGICOS
   Título "Comportamiento de indicadores"
   Para cada indicador escribe 2-3 líneas: cuántas tareas lo impactan,
   quiénes trabajan en él, si tiene momentum real o está estancado,
   y si va a cumplirse al ritmo actual.

6. ANÁLISIS INDIVIDUAL POR PERSONA
   Título "El equipo esta semana"
   Para cada persona genera un bloque con:
   - Nombre en bold 16px, color #ef7218, borde izquierdo 3px #ef7218, padding-left 12px
   - Línea de métricas en gris pequeño: X tareas | X finalizadas | Aporte X | Subtareas X/X
   - Párrafo "En qué trabaja": describe en lenguaje natural qué está haciendo
     realmente esta persona, basándote en sus comentarios y títulos de tareas.
     No listes tareas, narra lo que hace.
   - Párrafo "Se comprometió a entregar": resume sus entregables comprometidos.
     Si no tiene, escribe: "No registra entregables definidos — se recomienda precisar compromisos."
   - Párrafo "Análisis estratégico": como experto en marketing, qué de su trabajo
     tendrá mayor impacto a corto plazo, si está priorizando bien,
     y una recomendación concreta y específica para esta persona.
   - Badge de estado inline:
     "Alto rendimiento" fondo #0aa0ab texto blanco si va bien
     "En seguimiento" fondo #ef7218 texto blanco si necesita impulso
     "Requiere atención" fondo #e74c3c texto blanco si hay problemas

7. ALERTAS DE LA SEMANA
   Solo si hay tareas vencidas o en riesgo.
   Bloque con fondo #fff8f0 borde izquierdo #ef7218.
   Texto narrativo: "Las siguientes situaciones requieren atención esta semana:"
   seguido de lista clara con cada caso.

8. RECOMENDACIONES EJECUTIVAS
   Título con fondo #ef7218 texto blanco padding 12px.
   5 recomendaciones en lenguaje natural, numeradas.
   Cada una: acción concreta + responsable + urgencia.
   Escritas como las daría un consultor, no como checklist genérico.

9. CIERRE
   Párrafo de cierre ejecutivo: una frase que resuma el estado del equipo
   y el llamado a acción principal de la semana.

10. FOOTER
    Fondo #0aa0ab, texto blanco centrado, padding 20px, font-size 12px.
    "W Planner · Banco W · ${new Date().getFullYear()}"
    "Reporte generado con inteligencia artificial a partir de los datos del equipo"

REGLAS DE DISEÑO PARA CORREO:
- Todo el CSS debe ser inline (style="...") para compatibilidad con Gmail/Outlook
- No uses flexbox ni grid — usa table o inline-block para columnas
- No uses fuentes externas
- Imágenes: ninguna
- El correo debe verse bien en móvil (usa width 100% en contenedores internos con max-width)`;
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
