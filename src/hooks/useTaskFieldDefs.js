import { useState } from "react";
import { supabase } from "../supabaseClient";
import { useToast } from "../ui/Toast";

// Estado + CRUD del esquema de campos personalizados por proyecto
// (task_field_defs). Extraído del orquestador App (H-002, núcleo fase D).
//
// El estado y los setters se exponen porque el spine del App (loadAllForProject
// y el canal realtime único) siguen poblándolos; aquí vive la lógica de
// mutación. Cada helper devuelve la fila del servidor para que el modal de
// formulario reaccione de inmediato (realtime mantiene la lista en sync).
export function useTaskFieldDefs(projectId) {
  const toast = useToast();
  const [taskFieldDefs, setTaskFieldDefs] = useState([]);
  // false when migration 008 is not yet applied (custom_fields column / table
  // missing). Used to gracefully degrade taskToDb / addTaskFieldDef.
  const [hasCustomFieldsSchema, setHasCustomFieldsSchema] = useState(true);

  const addTaskFieldDef = async (payload) => {
    if (!projectId) return { error: new Error('No project selected') };
    let key = String(payload.key || '').trim();
    // Resolve collisions against ALL keys ever used in this project,
    // including soft-deleted ones, to avoid mixing archived historical values
    // (stored in tasks.custom_fields[key]) with new ones under the same key.
    if (key) {
      const { data: allKeys } = await supabase
        .from('task_field_defs')
        .select('key')
        .eq('project_id', projectId);
      const used = new Set((allKeys || []).map(r => r.key));
      if (used.has(key)) {
        const base = key.slice(0, 47);
        let n = 2;
        while (used.has(`${base}_${n}`) && n < 1000) n += 1;
        key = `${base}_${n}`;
      }
    }
    const insertPayload = {
      project_id: projectId,
      key,
      label: String(payload.label || '').trim(),
      type: payload.type,
      config: payload.config || {},
      position: typeof payload.position === 'number' ? payload.position : taskFieldDefs.length,
      required: !!payload.required,
      show_on_card: !!payload.show_on_card,
      show_in_presentation: !!payload.show_in_presentation,
    };
    const { data, error } = await supabase.from('task_field_defs').insert(insertPayload).select().single();
    // Aquí había un reintento "amable": si el error mencionaba
    // show_in_presentation, se volvía a insertar SIN esa columna y se devolvía
    // éxito. La columna no existía en producción (la migración 011 nunca se
    // aplicó), así que el interruptor "Mostrar en Presentación" parecía
    // guardarse, nunca persistía, y ningún campo salía en esa vista. Un fallo
    // de esquema disfrazado de éxito: exactamente lo que dejó las invitaciones
    // rotas durante meses. La columna ya existe (migración 20260807000000) y el
    // disfraz se retira: si vuelve a faltar algo, que se vea.
    if (!error && data) {
      setTaskFieldDefs(prev => {
        if (prev.find(d => d.id === data.id)) return prev;
        return [...prev, data].sort((a, b) => (a.position - b.position) || (a.id - b.id));
      });
    }
    return { data, error };
  };

  const updateTaskFieldDefById = async (id, patch) => {
    if (!projectId) return { error: new Error('No project selected') };
    const safePatch = { ...patch };
    // Never let the client move a def to another project or undelete via update.
    delete safePatch.project_id;
    delete safePatch.id;
    // Mismo caso que en el alta: se retira el reintento sin la columna, que
    // convertía un esquema desalineado en un guardado "exitoso" que no guardaba.
    const { data, error } = await supabase
      .from('task_field_defs')
      .update(safePatch)
      .eq('id', id)
      .eq('project_id', projectId)
      .select()
      .single();
    if (!error && data) {
      setTaskFieldDefs(prev => prev.map(d => d.id === id ? data : d).sort((a, b) => (a.position - b.position) || (a.id - b.id)));
    }
    return { data, error };
  };

  const deleteTaskFieldDef = async (id) => {
    if (!projectId) return { error: new Error('No project selected') };
    // Soft delete to preserve historical values stored in tasks.custom_fields.
    const { error } = await supabase
      .from('task_field_defs')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('project_id', projectId);
    if (!error) {
      setTaskFieldDefs(prev => prev.filter(d => d.id !== id));
    }
    return { error };
  };

  const reorderTaskFieldDefs = async (orderedIds) => {
    if (!projectId) return;
    // Guardamos el orden previo: si la persistencia falla, la pantalla no puede
    // quedarse mostrando un orden que la base nunca aceptó.
    let ordenPrevio = null;
    // Optimistic local reorder
    setTaskFieldDefs(prev => {
      ordenPrevio = prev;
      const map = new Map(prev.map(d => [d.id, d]));
      return orderedIds
        .map((id, idx) => map.get(id) ? { ...map.get(id), position: idx } : null)
        .filter(Boolean);
    });
    // Persist in parallel to minimise the realtime "list dancing" effect
    // (each UPDATE fires a separate event; doing them at once batches the
    // perceived re-render). For larger schemas consider an RPC.
    const ops = orderedIds.map((id, i) =>
      supabase.from('task_field_defs').update({ position: i }).eq('id', id).eq('project_id', projectId)
    );
    const results = await Promise.all(ops);
    const firstErr = results.find(r => r.error);
    if (firstErr) {
      console.error('Error reordenando campos:', firstErr.error);
      if (ordenPrevio) setTaskFieldDefs(ordenPrevio);
      toast('No se pudo guardar el nuevo orden de los campos: ' + firstErr.error.message, { type: 'error' });
      return false;
    }
    return true;
  };

  return {
    taskFieldDefs, setTaskFieldDefs,
    hasCustomFieldsSchema, setHasCustomFieldsSchema,
    addTaskFieldDef, updateTaskFieldDefById, deleteTaskFieldDef, reorderTaskFieldDefs,
  };
}
