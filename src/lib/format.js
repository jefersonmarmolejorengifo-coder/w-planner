// Helpers de presentación de usuario, compartidos por varias vistas. Extraídos
// del monolito (H-002).

const USER_COLORS = ["#ec6c04", "#0aa0ab", "#542c9c", "#e74c3c", "#27ae60", "#2980b9", "#e67e22", "#8e44ad", "#1abc9c", "#c0392b"];

// Color estable derivado del nombre (hash → paleta fija).
export const getUserColor = (name) =>
  USER_COLORS[Math.abs([...(name || "")].reduce((h, c) => h * 31 + c.charCodeAt(0), 0)) % USER_COLORS.length];

// Iniciales (hasta 2) en mayúscula. "Ana Martínez" → "AM".
export const getInitials = (name) =>
  (name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
