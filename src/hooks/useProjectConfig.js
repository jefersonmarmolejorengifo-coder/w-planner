import { useState } from "react";
import { supabase } from "../supabaseClient";
import { useToast } from "../ui/Toast";
import { DEFAULT_DIMENSIONS } from "../lib/aporte";

// Catálogos editables del proyecto (participants/indicators/taskTypes/
// dimensions) + sus persistencias, incluida la clave (pin). Extraído del
// orquestador App (H-002, núcleo fase D). Recibe projectId/project/setProject;
// expone los setters porque el spine (loadAllForProject + realtime, en App)
// sigue poblando los catálogos.
//
// REGLA DE ESTE ARCHIVO: ninguna escritura actualiza la pantalla sin haber
// comprobado antes que la base la aceptó. Hasta 2026-08-06 estas funciones
// ignoraban el resultado y llamaban al setter igualmente: si la escritura
// fallaba, el usuario veía su cambio aplicado y en la base no existía, y solo
// se enteraba al recargar. Es el mismo mecanismo que mantuvo oculto durante
// meses el bug de las invitaciones (ver src/lib/joinProject.js).
export function useProjectConfig({ projectId, project, setProject }) {
  const toast = useToast();
  const [participants, setParticipants] = useState([]);
  const [indicators, setIndicators] = useState([]);
  const [taskTypes, setTaskTypes] = useState([]);
  const [dimensions, setDimensions] = useState(DEFAULT_DIMENSIONS);

  // Ejecuta una escritura y acumula su error sin cortar la secuencia: se
  // mantiene el comportamiento previo de intentar todas las operaciones, pero
  // ahora sabemos cuáles fallaron.
  //
  // Ojo con `esperaFilas`: un UPDATE o DELETE que la RLS deniega NO devuelve
  // error, devuelve CERO FILAS. Por eso las escrituras piden `.select('id')` y
  // comprobamos que volvió algo. Mirar solo `error` deja pasar exactamente el
  // fallo silencioso que este archivo intenta erradicar.
  const run = async (errors, query, esperaFilas = true) => {
    const { data, error } = await query;
    if (error) { errors.push(error); return; }
    if (esperaFilas && Array.isArray(data) && data.length === 0) {
      errors.push({ message: 'el servidor no aplicó el cambio (sin permisos sobre este tablero)', code: 'ZERO_ROWS' });
    }
  };

  // Un único sitio donde se reporta el fallo, para que ninguna escritura pueda
  // quedar muda otra vez.
  const reportSaveError = (queNoSeGuardo, errors) => {
    console.error(`[useProjectConfig] no se pudo guardar ${queNoSeGuardo}`,
      errors.map(e => ({ code: e.code, message: e.message, details: e.details, hint: e.hint })));
    toast(`No se pudo guardar ${queNoSeGuardo}: ${errors[0].message}`, { type: 'error' });
  };

  const saveParticipants = async (updaterFn) => {
    const prev = participants;
    const next = typeof updaterFn === 'function' ? updaterFn(prev) : updaterFn;
    const toInsert = next.filter(n => !prev.find(p => p.id === n.id));
    const toUpdate = next.filter(n => prev.find(p => p.id === n.id));
    const toDelete = prev.filter(p => !next.find(n => n.id === p.id));
    const errors = [];
    for (const p of toInsert)
      await run(errors, supabase.from('participants').insert({ id: p.id, name: p.name, is_super_user: p.isSuperUser, project_id: projectId || undefined }).select('id'));
    for (const p of toUpdate)
      await run(errors, supabase.from('participants').update({ name: p.name, is_super_user: p.isSuperUser }).eq('id', p.id).eq('project_id', projectId).select('id'));
    for (const p of toDelete)
      await run(errors, supabase.from('participants').delete().eq('id', p.id).eq('project_id', projectId).select('id'));
    if (errors.length) { reportSaveError('los participantes', errors); return false; }
    setParticipants(next);
    return true;
  };

  const saveIndicators = async (updaterFn) => {
    const prev = indicators;
    const next = typeof updaterFn === 'function' ? updaterFn(prev) : updaterFn;
    const toInsert = next.filter(n => !prev.find(p => p.id === n.id));
    const toDelete = prev.filter(p => !next.find(n => n.id === p.id));
    const errors = [];
    for (const i of toInsert)
      await run(errors, supabase.from('indicators').insert({ id: i.id, name: i.name, project_id: projectId || undefined }).select('id'));
    for (const i of toDelete)
      await run(errors, supabase.from('indicators').delete().eq('id', i.id).eq('project_id', projectId).select('id'));
    if (errors.length) { reportSaveError('los indicadores', errors); return false; }
    setIndicators(next);
    return true;
  };

  const saveTaskTypes = async (updaterFn) => {
    const prev = taskTypes;
    const next = typeof updaterFn === 'function' ? updaterFn(prev) : updaterFn;
    const toInsert = next.filter(n => !prev.find(p => p.id === n.id));
    const toUpdate = next.filter(n => prev.find(p => p.id === n.id));
    const toDelete = prev.filter(p => !next.find(n => n.id === p.id));
    const errors = [];
    for (const t of toInsert)
      await run(errors, supabase.from('task_types').insert({ name: t.name, project_id: projectId || undefined }).select('id'));
    for (const t of toUpdate)
      await run(errors, supabase.from('task_types').update({ name: t.name }).eq('id', t.id).eq('project_id', projectId).select('id'));
    for (const t of toDelete)
      await run(errors, supabase.from('task_types').delete().eq('id', t.id).eq('project_id', projectId).select('id'));
    if (errors.length) reportSaveError('los tipos de tarea', errors);
    // Relee siempre: aunque algo fallara, la lista queda igual a la base y no a
    // lo que el usuario creía haber guardado.
    const { data, error } = await supabase.from('task_types').select('*').eq('project_id', projectId).order('name', { ascending: true });
    if (!error && data) setTaskTypes(data.map((t) => ({ id: t.id, name: t.name })));
    return next;
  };

  const saveDimensions = async (dims) => {
    const prevDims = dimensions;
    setDimensions(dims);
    if (projectId && project) {
      const newConfig = { ...(project.config || {}), dimensions: dims };
      // `.select('id')` no es decorativo: un UPDATE que la RLS bloquea NO
      // devuelve error, devuelve cero filas. Sin esto el fallo sería invisible.
      const { data, error } = await supabase.from('projects').update({ config: newConfig }).eq('id', projectId).select('id');
      if (error || !data?.length) {
        setDimensions(prevDims);
        reportSaveError('las dimensiones', [error || { message: 'el servidor no aplicó el cambio (sin permisos sobre este tablero)' }]);
        return false;
      }
      setProject(prev => ({ ...prev, config: newConfig }));
    }
    return true;
  };

  const saveProjectPin = async (pin) => {
    if (projectId && project) {
      const newConfig = { ...(project.config || {}), pin };
      const { data, error } = await supabase.from('projects').update({ config: newConfig }).eq('id', projectId).select('id');
      if (error || !data?.length) {
        reportSaveError('la clave de configuración', [error || { message: 'el servidor no aplicó el cambio (sin permisos sobre este tablero)' }]);
        return false;
      }
      setProject(prev => ({ ...prev, config: newConfig }));
    }
    return true;
  };

  return {
    participants, setParticipants,
    indicators, setIndicators,
    taskTypes, setTaskTypes,
    dimensions, setDimensions,
    saveParticipants, saveIndicators, saveTaskTypes, saveDimensions, saveProjectPin,
  };
}
