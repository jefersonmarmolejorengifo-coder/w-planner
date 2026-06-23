import { useState } from "react";
import { supabase } from "../supabaseClient";
import { DEFAULT_DIMENSIONS } from "../lib/aporte";

// Catálogos editables del proyecto (participants/indicators/taskTypes/
// dimensions) + sus persistencias, incluida la clave (pin). Extraído del
// orquestador App (H-002, núcleo fase D). Recibe projectId/project/setProject;
// expone los setters porque el spine (loadAllForProject + realtime, en App)
// sigue poblando los catálogos. Lógica verbatim: comportamiento idéntico.
export function useProjectConfig({ projectId, project, setProject }) {
  const [participants, setParticipants] = useState([]);
  const [indicators, setIndicators] = useState([]);
  const [taskTypes, setTaskTypes] = useState([]);
  const [dimensions, setDimensions] = useState(DEFAULT_DIMENSIONS);

  const saveParticipants = async (updaterFn) => {
    const prev = participants;
    const next = typeof updaterFn === 'function' ? updaterFn(prev) : updaterFn;
    const toInsert = next.filter(n => !prev.find(p => p.id === n.id));
    const toUpdate = next.filter(n => prev.find(p => p.id === n.id));
    const toDelete = prev.filter(p => !next.find(n => n.id === p.id));
    for (const p of toInsert)
      await supabase.from('participants').insert({ id: p.id, name: p.name, is_super_user: p.isSuperUser, project_id: projectId || undefined });
    for (const p of toUpdate)
      await supabase.from('participants').update({ name: p.name, is_super_user: p.isSuperUser }).eq('id', p.id).eq('project_id', projectId);
    for (const p of toDelete)
      await supabase.from('participants').delete().eq('id', p.id).eq('project_id', projectId);
    setParticipants(next);
  };

  const saveIndicators = async (updaterFn) => {
    const prev = indicators;
    const next = typeof updaterFn === 'function' ? updaterFn(prev) : updaterFn;
    const toInsert = next.filter(n => !prev.find(p => p.id === n.id));
    const toDelete = prev.filter(p => !next.find(n => n.id === p.id));
    for (const i of toInsert)
      await supabase.from('indicators').insert({ id: i.id, name: i.name, project_id: projectId || undefined });
    for (const i of toDelete)
      await supabase.from('indicators').delete().eq('id', i.id).eq('project_id', projectId);
    setIndicators(next);
  };

  const saveTaskTypes = async (updaterFn) => {
    const prev = taskTypes;
    const next = typeof updaterFn === 'function' ? updaterFn(prev) : updaterFn;
    const toInsert = next.filter(n => !prev.find(p => p.id === n.id));
    const toUpdate = next.filter(n => prev.find(p => p.id === n.id));
    const toDelete = prev.filter(p => !next.find(n => n.id === p.id));
    for (const t of toInsert)
      await supabase.from('task_types').insert({ name: t.name, project_id: projectId || undefined });
    for (const t of toUpdate)
      await supabase.from('task_types').update({ name: t.name }).eq('id', t.id).eq('project_id', projectId);
    for (const t of toDelete)
      await supabase.from('task_types').delete().eq('id', t.id).eq('project_id', projectId);
    const { data, error } = await supabase.from('task_types').select('*').eq('project_id', projectId).order('name', { ascending: true });
    if (!error && data) setTaskTypes(data.map((t) => ({ id: t.id, name: t.name })));
    return next;
  };

  const saveDimensions = async (dims) => {
    setDimensions(dims);
    if (projectId && project) {
      const newConfig = { ...(project.config || {}), dimensions: dims };
      await supabase.from('projects').update({ config: newConfig }).eq('id', projectId);
      setProject(prev => ({ ...prev, config: newConfig }));
    }
  };

  const saveProjectPin = async (pin) => {
    if (projectId && project) {
      const newConfig = { ...(project.config || {}), pin };
      await supabase.from('projects').update({ config: newConfig }).eq('id', projectId);
      setProject(prev => ({ ...prev, config: newConfig }));
    }
  };

  return {
    participants, setParticipants,
    indicators, setIndicators,
    taskTypes, setTaskTypes,
    dimensions, setDimensions,
    saveParticipants, saveIndicators, saveTaskTypes, saveDimensions, saveProjectPin,
  };
}
