import { useCallback, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

// Carga el historial de cambios (tabla `task_history`) de UNA tarea a la vez,
// con guarda contra respuestas fuera de orden.
//
// Bug que motivó este hook (reportado por el dueño: "el historial de cada
// tarea trae detalles de otras tarjetas"):
//   1) El formulario de "Nueva tarea" no limpiaba el historial: heredaba el
//      de la última tarjeta abierta. Se arregla llamando a `clear()` al abrir
//      una tarea nueva.
//   2) `openEdit`/`openFromDependencyGraph` disparaban la consulta sin guarda
//      de respuesta vieja: si se abría la tarjeta A y enseguida la B, la
//      respuesta de A podía llegar tarde y pisar el historial de B.
// `load()` numera cada petición (requestIdRef) y descarta en silencio
// cualquier respuesta cuyo número ya no sea el más reciente.
export function useTaskHistory() {
  const [history, setHistory] = useState([]);
  const requestIdRef = useRef(0);

  const clear = useCallback(() => {
    // Invalida cualquier consulta en vuelo: aunque responda después, su
    // requestId ya no coincidirá con el actual y `load` la descartará.
    requestIdRef.current += 1;
    setHistory([]);
  }, []);

  const load = useCallback(async (taskId, projectId) => {
    const requestId = ++requestIdRef.current;
    // Limpia de inmediato: mientras llega la respuesta nueva, no debe seguir
    // mostrándose el historial de la tarjeta anterior.
    setHistory([]);
    if (!projectId || taskId == null) return;
    const { data } = await supabase
      .from('task_history')
      .select('*')
      .eq('task_id', taskId)
      .eq('project_id', projectId)
      .order('changed_at', { ascending: false })
      .limit(20);
    // Si mientras esperábamos se pidió el historial de OTRA tarea (o se
    // limpió), esta respuesta ya quedó vieja: se descarta sin tocar el estado.
    if (requestId !== requestIdRef.current) return;
    if (data) setHistory(data);
  }, []);

  return { history, load, clear };
}
