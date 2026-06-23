import { useState } from "react";
import { supabase } from "../supabaseClient";
import { calcAporte } from "../lib/aporte";
import { getColombiaNow } from "../lib/format";
import { readCustomFieldValue } from "../lib/customFields";
import { dbToTask, taskToDb } from "../lib/taskMapping";

// Estado + CRUD de tareas (tasks/nextId) extraído del orquestador App
// (H-002, núcleo fase D). Recibe del App el contexto que necesita
// (projectId, dimensions, hasCustomFieldsSchema, activeUser, taskFieldDefs) y
// expone setTasks/setNextId porque el spine (loadAllForProject + canal realtime,
// que siguen en App) los sigue poblando. Lógica verbatim: comportamiento idéntico.
export function useTasks({ projectId, dimensions, hasCustomFieldsSchema, activeUser, taskFieldDefs }) {
  const [tasks, setTasks] = useState([]);
  const [nextId, setNextId] = useState(1);

  const createTask = async (task) => {
    if (task.status === 'Finalizada' && !task.finalizedAt) {
      task = { ...task, finalizedAt: getColombiaNow() };
    }
    const dbTask = { ...taskToDb(task), project_id: projectId || undefined };
    if (Array.isArray(dimensions) && dimensions.length) {
      dbTask.aporte_snapshot = calcAporte(task, dimensions);
    }
    // Strip fields added by migration 008 when the schema is not yet applied
    // so the insert does not fail with 42703 on an older DB.
    if (!hasCustomFieldsSchema) {
      delete dbTask.custom_fields;
      delete dbTask.last_modified_by;
    }
    const { error } = await supabase.from('tasks').insert(dbTask);
    if (!error) {
      setTasks(prev => [...prev, task]);
    } else {
      console.error('Error creando tarea:', error);
      alert('Error al guardar la tarea: ' + error.message);
    }
  };

  const updateTask = async (task) => {
    if (task.status === 'Finalizada' && !task.finalizedAt) {
      task = { ...task, finalizedAt: getColombiaNow() };
    }
    // Stamp the editor for the "last modified by" auto field. Server-side
    // updated_at / closed_at are handled by the set_task_auto_fields trigger.
    if (activeUser?.name) {
      task = { ...task, lastModifiedBy: activeUser.name };
    }
    const dbTask = { ...taskToDb(task) };
    if (Array.isArray(dimensions) && dimensions.length) {
      dbTask.aporte_snapshot = calcAporte(task, dimensions);
    }
    if (!hasCustomFieldsSchema) {
      delete dbTask.custom_fields;
      delete dbTask.last_modified_by;
    }
    // Optimistic concurrency (H-016): la actualización solo aplica si la fila no
    // cambió desde que se cargó (mismo updated_at). Evita lost updates cuando dos
    // personas editan la misma tarjeta a la vez. Si updatedAt no está disponible
    // (BD sin migración 008), se omite el guard y se mantiene el comportamiento previo.
    const prevUpdatedAt = task.updatedAt;
    let updateQuery = supabase.from('tasks').update(dbTask).eq('id', task.id);
    if (projectId) updateQuery = updateQuery.eq('project_id', projectId);
    if (prevUpdatedAt) updateQuery = updateQuery.eq('updated_at', prevUpdatedAt);
    const { data: updatedRows, error } = await updateQuery.select();

    // Conflicto: con guard activo, 0 filas afectadas significa que el updated_at
    // ya no coincide → otra persona modificó (o borró) la tarjeta. Recargamos la
    // versión del servidor y avisamos, sin pisar los cambios ajenos.
    if (!error && prevUpdatedAt && (!updatedRows || updatedRows.length === 0)) {
      let freshQuery = supabase.from('tasks').select('*').eq('id', task.id);
      if (projectId) freshQuery = freshQuery.eq('project_id', projectId);
      const { data: freshRow } = await freshQuery.maybeSingle();
      if (freshRow) {
        const fresh = dbToTask(freshRow);
        setTasks(prev => prev.map(t => t.id === task.id ? fresh : t));
        alert('Esta tarjeta fue modificada por otra persona mientras la editabas. Se recargó con la versión más reciente; vuelve a abrirla para reaplicar tus cambios.');
      } else {
        setTasks(prev => prev.filter(t => t.id !== task.id));
        alert('Esta tarjeta fue eliminada por otra persona mientras la editabas.');
      }
      return;
    }

    if (!error) {
      // Log significant field changes to task_history
      if (projectId && activeUser) {
        const oldTask = tasks.find(t => t.id === task.id);
        if (oldTask) {
          const tracked = [
            { field: 'status', oldV: oldTask.status, newV: task.status },
            { field: 'responsible', oldV: oldTask.responsible, newV: task.responsible },
            { field: 'progressPercent', oldV: String(oldTask.progressPercent), newV: String(task.progressPercent) },
          ];
          // Diff custom fields too. We only audit keys present in either
          // old or new map — defs that didn't exist when the row was written
          // still surface here if the value differs.
          const oldCustom = oldTask.customFields || {};
          const newCustom = task.customFields || {};
          const allCustomKeys = new Set([...Object.keys(oldCustom), ...Object.keys(newCustom)]);
          // Stable serializer: sort object keys recursively so that two
          // semantically equal objects produce the same string, avoiding
          // phantom diffs in task_history.
          const stableStringify = (v) => {
            if (v === undefined || v === null) return '';
            if (Array.isArray(v)) {
              try { return '[' + v.map(stableStringify).join(',') + ']'; } catch { return String(v); }
            }
            if (typeof v === 'object') {
              try {
                const keys = Object.keys(v).sort();
                return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
              } catch { return String(v); }
            }
            return JSON.stringify(v);
          };
          const stringify = stableStringify;
          allCustomKeys.forEach((k) => {
            const ov = stringify(oldCustom[k]);
            const nv = stringify(newCustom[k]);
            if (ov !== nv) {
              tracked.push({ field: `customField:${k}`, oldV: ov, newV: nv });
            }
          });
          for (const f of tracked) {
            if (f.oldV !== f.newV) {
              supabase.from('task_history').insert({ task_id: task.id, project_id: projectId, changed_by: activeUser.name, field_name: f.field, old_value: f.oldV, new_value: f.newV }).then(() => {});
            }
          }
        }
      }
      // Refresca updatedAt local desde la fila devuelta para que ediciones
      // sucesivas en la misma sesión no choquen con un updated_at obsoleto.
      const newUpdatedAt = updatedRows?.[0]?.updated_at || task.updatedAt;
      const merged = { ...task, updatedAt: newUpdatedAt };
      setTasks(prev => prev.map(t => t.id === task.id ? merged : t));
    } else {
      console.error('Error actualizando tarea:', error);
      alert('Error al actualizar la tarea: ' + error.message);
    }
  };

  const deleteTask = async (id) => {
    let deleteQuery = supabase.from('tasks').delete().eq('id', id);
    if (projectId) deleteQuery = deleteQuery.eq('project_id', projectId);
    const { error } = await deleteQuery;
    if (!error) {
      setTasks(prev => prev.filter(t => t.id !== id));
    } else {
      console.error('Error eliminando tarea:', error);
    }
  };

  const exportCSV = () => {
    if (tasks.length === 0) { alert("No hay tareas para exportar."); return; }
    // Compute custom-field columns from the active defs so each tenant gets
    // exactly its schema. Soft-deleted defs are skipped; their values stay
    // in tasks.custom_fields for audit but aren't exported.
    // Skip type='auto' defs: their underlying columns (created/updated/closed/
    // last_modified_by) are already covered by builtin headers, so re-exporting
    // them would duplicate columns in Excel.
    const activeDefs = (taskFieldDefs || []).filter(d => !d.deleted_at && d.type !== 'auto');
    const formatForCsv = (def, t) => {
      const v = readCustomFieldValue(def, t);
      if (v === undefined || v === null) return '';
      if (def.type === 'multiselect') return Array.isArray(v) ? v.join(' | ') : String(v);
      if (def.type === 'subitems') return Array.isArray(v) ? v.map(i => (i.done ? '✓ ' : '○ ') + (i.text || '')).join(' | ') : '';
      return String(v);
    };
    const data = tasks.map((t) => {
      const row = {
        "ID": t.id,
        "Valor de Aporte": t.aporteSnapshot ?? "—",
        "Fecha de creación": t.createdAt,
        "Indicador que impacta": t.indicator,
        "Título": t.title,
        "Tipo": t.type,
        "Estado": t.status,
        "Validación cierre": t.validationClose || "",
        "Fecha de inicio": t.startDate,
        "Fecha de fin": t.endDate,
        "Tiempo estimado (★)": t.estimatedTime,
        "Dificultad estimada (★)": t.difficulty,
        "Valor estratégico (★)": t.strategicValue,
        "Avance condicionado ext.": t.extProgress1,
        "Avance condicionado int.": t.extProgress2,
        "Entrega esperada": t.expectedDelivery,
        "Responsable": t.responsible,
        "Comentarios": t.comments,
        "Porcentaje de avance": `${Number(t.progressPercent || 0).toFixed(1)}%`,
        "Subtareas": t.subtasks.map(s => (s.done ? "✓ " : "○ ") + (s.text || s)).join(" | "),
        "Tarea dependiente (ID)": t.dependentTask || "",
      };
      // Append one column per active custom field. Label collisions with
      // builtin headers OR with another custom field get the [key] suffix,
      // which is guaranteed unique by the DB unique index. Two custom fields
      // sharing a label is a realistic scenario; collapsing them silently
      // would lose data in Excel.
      const used = new Set(Object.keys(row));
      activeDefs.forEach(def => {
        let header = def.label || def.key;
        if (used.has(header)) header = `${header} [${def.key}]`;
        if (used.has(header)) header = `${header} (campo personalizado) [${def.key}]`;
        used.add(header);
        row[header] = formatForCsv(def, t);
      });
      return row;
    });
    // Union of all keys across rows preserves builtin order, then custom
    // fields in the order returned by activeDefs. Some rows may be missing
    // custom keys if their task was created before a def was added — fall
    // back to empty cells for those.
    const headers = Array.from(data.reduce((s, row) => {
      Object.keys(row).forEach(k => s.add(k));
      return s;
    }, new Set()));
    const escapeCell = (value) => {
      const text = String(value ?? "");
      return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const csv = [
      headers.map(escapeCell).join(","),
      ...data.map((row) => headers.map((header) => escapeCell(row[header])).join(",")),
    ].join("\r\n");
    const blob = new Blob([String.fromCharCode(0xFEFF) + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `productivity-plus_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return { tasks, setTasks, nextId, setNextId, createTask, updateTask, deleteTask, exportCSV };
}
