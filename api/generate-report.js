import { Anthropic } from "anthropic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const REPO_URL = "https://github.com/devcodo/w-planner";
const DEFAULT_SYSTEM = `Eres un asistente experto en gerencia de proyectos y reportes semanales de tareas.
Tu misión es generar un resumen y un HTML profesional para el equipo de Banco W.
Utiliza otro texto si el contenido tiene poca información, pero nunca inventes fechas ni porcentajes.
Siempre mantén el resultado en español. Usa un tono directo, claro y orientado a la acción.`;

function buildPrompt({ weekStart, weekEnd, tasks }) {
  return `
${DEFAULT_SYSTEM}

Repositorio: ${REPO_URL}
Periodo: ${weekStart} - ${weekEnd}

Tareas:
${tasks
    .map(
      (task, index) =>
        `${index + 1}. ${task.title || "(sin título)"} \n   Estado: ${task.status || "Sin iniciar"} \n   Responsable: ${task.responsible || "No asignado"} \n   Progreso: ${task.progress_percent ?? 0}% \n   Prioridad: ${task.priority || "No definida"} \n   Descripción: ${task.description || "Sin descripción"}`
    )
    .join("\n\n")}

Genera:
1. Un título breve para el reporte.
2. Un resumen ejecutivo de los principales avances.
3. Una tabla HTML con columnas: Tarea, Responsable, Estado, Progreso.
4. Un párrafo final de recomendaciones.
`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { weekStart, weekEnd, tasks } = req.body || {};
  if (!weekStart || !weekEnd || !Array.isArray(tasks)) {
    return res.status(400).json({ error: "weekStart, weekEnd y tasks son requeridos" });
  }

  try {
    const prompt = buildPrompt({ weekStart, weekEnd, tasks });
    const response = await anthropic.responses.create({
      model: "claude-3.5",
      input: prompt,
      max_tokens: 800,
    });

    const text = response.output?.[0]?.content?.[0]?.text;
    if (!text) {
      throw new Error("No se recibió respuesta de Anthropic");
    }

    return res.status(200).json({
      html: text,
      text,
      weekStart,
      weekEnd,
      taskCount: tasks.length,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Error generando reporte" });
  }
}
