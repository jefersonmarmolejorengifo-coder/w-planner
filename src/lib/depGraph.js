import { parseDeps } from "./deps";

// Layout del grafo de dependencias por niveles. Compartido por la Red de Tareas
// (DependenciesTab) y la Presentación (PresentationGraph). Extraído del monolito (H-002).
export const NODE_W = 170;
export const NODE_H = 76;
export const NODE_GAP_X = 60;
export const NODE_GAP_Y = 16;

export function computeDepLayout(tasks) {
  const byId = {};
  tasks.forEach(t => { byId[String(t.id)] = t; });
  const levels = {};
  const computing = new Set();
  const getLevel = (id) => {
    if (levels[id] !== undefined) return levels[id];
    if (computing.has(id)) return 0;
    computing.add(id);
    const t = byId[id];
    const depIds = parseDeps(t?.dependentTask);
    if (!t || depIds.length === 0) { levels[id] = 0; }
    else { levels[id] = Math.max(...depIds.map(did => getLevel(did))) + 1; }
    computing.delete(id);
    return levels[id];
  };
  tasks.forEach(t => getLevel(String(t.id)));

  const byLevel = {};
  tasks.forEach(t => {
    const lvl = levels[String(t.id)] ?? 0;
    if (!byLevel[lvl]) byLevel[lvl] = [];
    byLevel[lvl].push(t);
  });

  const positions = {};
  Object.entries(byLevel).forEach(([lvl, ts]) => {
    ts.forEach((t, i) => {
      positions[String(t.id)] = {
        x: Number(lvl) * (NODE_W + NODE_GAP_X) + 24,
        y: i * (NODE_H + NODE_GAP_Y) + 24,
      };
    });
  });

  const maxLvl = Math.max(...Object.keys(byLevel).map(Number), 0);
  const maxRows = Math.max(...Object.values(byLevel).map(a => a.length), 1);
  return {
    positions,
    levels,
    svgW: (maxLvl + 1) * (NODE_W + NODE_GAP_X) + 48,
    svgH: maxRows * (NODE_H + NODE_GAP_Y) + 48,
    byLevel,
  };
}
