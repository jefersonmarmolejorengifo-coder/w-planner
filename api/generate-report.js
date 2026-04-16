export const config = { runtime: 'edge' };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function buildPrompt({ weekStart, weekEnd, tasks }) {

  const total = tasks.length;
  const porEstado = tasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1; return acc;
  }, {});
  const progresoPromedio = total > 0
    ? (tasks.reduce((s, t) => s + parseFloat(t.progressPercent || t.progress_percent || 0), 0) / total).toFixed(1) : 0;
  const aporteTotal = tasks.reduce((s, t) => s + parseFloat(t.aporteSnapshot || t.aporte_snapshot || 0), 0).toFixed(1);

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
    acc[r].aporteTotal += parseFloat(t.aporteSnapshot || t.aporte_snapshot || 0);
    if (t.comments && t.comments.trim()) acc[r].comentarios.push(`Tarea #${t.id} "${t.title}": ${t.comments.trim()}`);
    const ed = t.expectedDelivery || t.expected_delivery || "";
    if (ed.trim()) acc[r].entregables.push(`Tarea #${t.id} "${t.title}": ${ed.trim()}`);
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
      acc[nombre].aporte += parseFloat(t.aporteSnapshot || t.aporte_snapshot || 0);
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

  const prog = (t) => t.progressPercent || t.progress_percent || 0;
  const aporte = (t) => t.aporteSnapshot || t.aporte_snapshot || 0;

  const todosLosTextos = tasks.map(t =>
    `#${t.id} | ${t.title} | ${t.responsible || "N/A"} | ${t.status} | ${prog(t)}% | Indicador: ${t.indicator || "N/A"} | Entregable: ${t.expectedDelivery || t.expected_delivery || "no definido"} | Comentarios: ${t.comments || "sin comentarios"} | Subtareas: ${Array.isArray(t.subtasks) ? t.subtasks.map(s => (s.done ? "[✓]" : "[ ]") + s.text).join(", ") : "ninguna"}`
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
    `- #${t.id} "${t.title}" | Resp: ${t.responsible || "N/A"} | Venció: ${t.endDate || t.end_date} | Progreso: ${prog(t)}%`
  ).join("\n") || "Ninguna";

  const detalleRiesgo = enRiesgo.map(t => {
    const dias = Math.ceil((new Date(t.endDate || t.end_date) - hoy) / (1000 * 60 * 60 * 24));
    return `- #${t.id} "${t.title}" | Resp: ${t.responsible || "N/A"} | Vence en ${dias} día(s) | Progreso: ${prog(t)}%`;
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
   - Qué grandes temas o iniciativas conectan al equipo
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
   - Párrafo "En qué trabaja": narra en lenguaje natural basándote en comentarios y títulos.
   - Párrafo "Se comprometió a entregar": resume entregables.
   - Párrafo "Análisis estratégico": recomendación concreta.
   - Badge: "Alto rendimiento" #0aa0ab / "En seguimiento" #ef7218 / "Requiere atención" #e74c3c

7. ALERTAS DE LA SEMANA
   Solo si hay tareas vencidas o en riesgo.
   Bloque con fondo #fff8f0 borde izquierdo #ef7218.

8. RECOMENDACIONES EJECUTIVAS
   Título con fondo #ef7218 texto blanco padding 12px.
   5 recomendaciones concretas con responsable y urgencia.

9. CIERRE
   Una frase ejecutiva que resuma el estado del equipo.

10. FOOTER
    Fondo #0aa0ab, texto blanco centrado, padding 20px, font-size 12px.
    "W Planner · Banco W · ${new Date().getFullYear()}"

REGLAS DE DISEÑO PARA CORREO:
- Todo el CSS debe ser inline (style="...") para compatibilidad con Gmail/Outlook
- No uses flexbox ni grid — usa table o inline-block para columnas
- No uses fuentes externas
- Imágenes: ninguna
- El correo debe verse bien en móvil (usa width 100% con max-width)`;
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS });
  if (req.method !== "POST") return jsonError("Method not allowed", 405);

  let body;
  try { body = await req.json(); } catch { return jsonError("Body inválido", 400); }

  const { weekStart, weekEnd, tasks, participants, indicators } = body;
  if (!weekStart || !weekEnd || !Array.isArray(tasks)) {
    return jsonError("weekStart, weekEnd y tasks son requeridos", 400);
  }

  const prompt = buildPrompt({ weekStart, weekEnd, tasks, participants, indicators });

  // Call Anthropic with streaming enabled
  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      stream: true,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!anthropicRes.ok) {
    let errMsg = `Anthropic API error ${anthropicRes.status}`;
    try { const e = await anthropicRes.json(); errMsg = e.error?.message || errMsg; } catch {}
    return jsonError(errMsg, 502);
  }

  // Transform Anthropic SSE stream → plain HTML text stream
  const reader = anthropicRes.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const htmlStream = new ReadableStream({
    async start(controller) {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const evt = JSON.parse(data);
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                controller.enqueue(encoder.encode(evt.delta.text));
              }
            } catch {}
          }
        }
      } catch (err) {
        controller.enqueue(encoder.encode(`<!-- stream error: ${err.message} -->`));
      }
      controller.close();
    },
  });

  return new Response(htmlStream, {
    headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" },
  });
}
