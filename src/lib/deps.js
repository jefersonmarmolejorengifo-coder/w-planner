// Parser de dependencias de tareas, compartido por el tablero, la red de tareas,
// la presentación y las super-tareas. Extraído del monolito (H-002).
// Parse "12,15,18" o legacy "12" → ["12","15","18"].
export const parseDeps = (depStr) => {
  if (!depStr) return [];
  return String(depStr).split(',').map(s => s.trim()).filter(Boolean);
};
