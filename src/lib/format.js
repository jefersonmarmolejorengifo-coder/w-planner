// Helpers de presentación de usuario, compartidos por varias vistas. Extraídos
// del monolito (H-002).

const USER_COLORS = ["#ec6c04", "#0aa0ab", "#542c9c", "#e74c3c", "#27ae60", "#2980b9", "#e67e22", "#8e44ad", "#1abc9c", "#c0392b"];

// Color estable derivado del nombre (hash → paleta fija).
export const getUserColor = (name) =>
  USER_COLORS[Math.abs([...(name || "")].reduce((h, c) => h * 31 + c.charCodeAt(0), 0)) % USER_COLORS.length];

// Iniciales (hasta 2) en mayúscula. "Ana Martínez" → "AM".
export const getInitials = (name) =>
  (name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

// Timestamp "ahora" en zona horaria de Colombia (formato es-CO, 24h). Lo usan
// la creación/edición de tareas y el cierre desde Mi Día.
export const getColombiaNow = () => {
  const d = new Date();
  return d.toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
};

// ── Fechas ───────────────────────────────────────────────────────────────────
// El producto vive en horario de Colombia (UTC-5, sin horario de verano), pero
// varias vistas calculaban "hoy" con `new Date().toISOString()`, que da la fecha
// UTC. Desde las 19:00 de Bogotá eso ya es el día siguiente: una tarea que vence
// HOY aparecía como VENCIDA cinco horas antes de tiempo, todas las tardes.

// "Hoy" en Colombia, en formato ISO (YYYY-MM-DD). en-CA produce justo ese orden.
export const hoyColombia = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

// Date cuyos campos LOCALES son la fecha de pared en Colombia. Sirve para hacer
// aritmética de días (getDate/setDate) y volver a formatear con isoLocal sin que
// el huso mueva el resultado a mitad de camino.
export const fechaColombiaHoy = () => {
  const [a, m, d] = hoyColombia().split("-").map(Number);
  return new Date(a, m - 1, d);
};

// "YYYY-MM-DD" de un Date usando sus campos LOCALES (no los UTC).
export const isoLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Convierte "YYYY-MM-DD" en un Date con esa fecha en horario LOCAL.
// `new Date("2026-01-01")` es medianoche UTC y en Bogotá se muestra como el 31
// de diciembre: así, un OKR que arranca el 1 de enero se agrupaba bajo el año
// anterior. El constructor por partes no tiene ese corrimiento.
export const fechaDesdeISO = (iso) => {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return new Date(iso);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

// Formatea una fecha "YYYY-MM-DD" para mostrar, sin corrimiento de huso.
export const formatearFechaISO = (iso, opciones = { day: "numeric", month: "short" }) => {
  const d = fechaDesdeISO(iso);
  return d ? d.toLocaleDateString("es-CO", opciones) : "";
};
