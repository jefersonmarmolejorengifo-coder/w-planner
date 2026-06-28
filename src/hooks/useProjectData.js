import { useState, useEffect } from "react";
import { supabase } from "../supabaseClient";
import { dbToTask } from "../lib/taskMapping";
import { useProjectConfig } from "./useProjectConfig";
import { useTaskFieldDefs } from "./useTaskFieldDefs";
import { useTasks } from "./useTasks";

// Fachada de TODOS los datos del proyecto (H-002, núcleo fase D — consolidación).
// Compone los hooks de dominio (useProjectConfig / useTaskFieldDefs / useTasks) y
// posee el "spine": el estado de nivel proyecto (projectId/project/loading/okrs/
// keyResults/sprints/currentUserId), la carga masiva (loadAllForProject) y el canal
// realtime. El spine vive aquí, junto a los setters que muta — sin pasar 20
// parámetros. App consume un único hook y conserva solo auth/UI + orquestación.
//
// Recibe activeUser/setActiveUser porque la sesión (activeUser) la coordina App
// junto con usePresence; loadAllForProject fija el usuario activo al cargar.
export function useProjectData({ activeUser, setActiveUser }) {
  const [projectId, setProjectId] = useState(null);
  const [project, setProject] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [okrs, setOkrs] = useState([]);
  const [keyResults, setKeyResults] = useState([]);
  const [sprints, setSprints] = useState([]);

  const {
    participants, setParticipants,
    indicators, setIndicators,
    taskTypes, setTaskTypes,
    dimensions, setDimensions,
    saveParticipants, saveIndicators, saveTaskTypes, saveDimensions, saveProjectPin,
  } = useProjectConfig({ projectId, project, setProject });

  const {
    taskFieldDefs, setTaskFieldDefs,
    hasCustomFieldsSchema, setHasCustomFieldsSchema,
    addTaskFieldDef, updateTaskFieldDefById, deleteTaskFieldDef, reorderTaskFieldDefs,
  } = useTaskFieldDefs(projectId);

  const {
    tasks, setTasks, nextId, setNextId,
    createTask, updateTask, deleteTask, exportCSV,
  } = useTasks({ projectId, dimensions, hasCustomFieldsSchema, activeUser, taskFieldDefs });

  const loadAllForProject = async (pid, proj, authUser = null) => {
    setLoading(true);
    try {
      // Columnas explícitas de tasks = exactamente las que lee dbToTask (taskMapping.js).
      // Omite columnas legacy/no usadas (inserted_at, subtasks_done) y, sobre todo, actúa
      // de guardrail de egress: si a futuro se agrega una columna pesada a tasks (un
      // embedding, un historial JSONB), NO se descargará para todos en cada apertura del
      // tablero sin querer. tasks es la ÚNICA tabla que crece sin límite; el resto es chico,
      // por eso solo aquí vale narrar columnas (las demás se dejan en select('*')).
      const TASK_COLS = 'id, created_at_colombia, indicator, indicators, title, start_date, end_date, estimated_time, type, status, validation_close, ext_progress1, ext_progress2, difficulty, strategic_value, expected_delivery, responsible, comments, progress_percent, subtasks, dependent_task, aporte_snapshot, finalized_at, dimension_values, kr_id, sprint_id, custom_fields, updated_at, closed_at, last_modified_by';
      const q = (table) => pid ? supabase.from(table).select('*').eq('project_id', pid) : supabase.from(table).select('*');
      const qTasks = () => pid ? supabase.from('tasks').select(TASK_COLS).eq('project_id', pid) : supabase.from('tasks').select(TASK_COLS);
      const [
        { data: tasksData },
        { data: partsData },
        { data: indsData },
        { data: typesData },
        { data: configData },
        { data: okrsData },
        { data: sprintsData },
        { data: fieldDefsData, error: fieldDefsErr },
      ] = await Promise.all([
        qTasks().order('id'),
        q('participants').order('id'),
        q('indicators').order('id'),
        pid ? supabase.from('task_types').select('*').eq('project_id', pid).order('name', { ascending: true }) : supabase.from('task_types').select('*').order('name', { ascending: true }),
        q('app_config'),
        pid ? supabase.from('okrs').select('*').eq('project_id', pid).order('start_date', { ascending: false }) : Promise.resolve({ data: [] }),
        pid ? supabase.from('sprints').select('*').eq('project_id', pid).order('created_at') : Promise.resolve({ data: [] }),
        pid
          ? supabase.from('task_field_defs').select('*').eq('project_id', pid).is('deleted_at', null).order('position', { ascending: true }).order('id', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (tasksData) setTasks(tasksData.map(dbToTask));
      if (partsData) setParticipants(partsData.map(p => ({ id: p.id, name: p.name, isSuperUser: p.is_super_user, isLegacy: p.is_legacy === true, authUserId: p.auth_user_id || null })));
      if (indsData) setIndicators(indsData);
      if (typesData) setTaskTypes(typesData.map(t => ({ id: t.id, name: t.name })));
      if (configData) {
        configData.forEach(row => {
          if (row.key === 'nextId') setNextId(Number(row.value));
          if (row.key === 'currentUserId') setCurrentUserId(row.value === null ? null : Number(row.value));
        });
      }

      if (okrsData) {
        setOkrs(okrsData);
        if (okrsData.length) {
          const okrIds = okrsData.map(o => o.id);
          const { data: krsData } = await supabase.from('key_results').select('*').in('okr_id', okrIds).order('id');
          if (krsData) {
            // Enriquece cada KR con las fechas de su OKR padre para que los
            // formularios puedan filtrar por rango sin pedir okrs como prop.
            const okrById = Object.fromEntries(okrsData.map(o => [o.id, o]));
            const enriched = krsData.map(kr => ({
              ...kr,
              okr_start_date: okrById[kr.okr_id]?.start_date || null,
              okr_end_date: okrById[kr.okr_id]?.end_date || null,
              okr_status: okrById[kr.okr_id]?.status || null,
            }));
            setKeyResults(enriched);
          }
        }
      }
      if (sprintsData) setSprints(sprintsData);
      // task_field_defs may fail silently on old DBs (pre-migration 008);
      // treat absent as "no custom fields configured" so the app still works.
      if (fieldDefsErr) {
        if (fieldDefsErr.code === '42P01') {
          console.warn('task_field_defs table not found — apply migration 008 to enable custom fields.');
          setHasCustomFieldsSchema(false);
        } else {
          console.error('Error cargando task_field_defs:', fieldDefsErr);
          setHasCustomFieldsSchema(true);
        }
        setTaskFieldDefs([]);
      } else {
        setHasCustomFieldsSchema(true);
        setTaskFieldDefs(Array.isArray(fieldDefsData) ? fieldDefsData : []);
      }

      // Load dimensions and pin from project config
      const p = proj || project;
      if (p?.config) {
        if (Array.isArray(p.config.dimensions) && p.config.dimensions.length) setDimensions(p.config.dimensions);
      }

      if (!partsData?.length && pid) {
        const { data: createdDefault } = await supabase
          .from('participants')
          .insert({ name: 'Usuario', is_super_user: true, project_id: pid })
          .select()
          .single();
        if (createdDefault) setParticipants([{ id: createdDefault.id, name: createdDefault.name, isSuperUser: true }]);
      }

      // Auto-set active user from auth
      if (authUser && pid) {
        const userName = authUser.user_metadata?.full_name || authUser.email.split('@')[0];
        const isOwner = (proj || p)?.owner_id === authUser.id;
        let part = partsData?.find(p2 => p2.auth_user_id === authUser.id || (p2.email && p2.email === authUser.email));
        if (!part) {
          const { data: created } = await supabase.from('participants').insert({
            name: userName, is_super_user: isOwner, project_id: pid,
            auth_user_id: authUser.id, email: authUser.email
          }).select().single();
          if (created) {
            part = created;
            setParticipants(prev => [...prev.filter(p2 => p2.id !== created.id), { id: created.id, name: created.name, isSuperUser: isOwner }]);
          }
        }
        if (part) {
          setActiveUser({ id: part.id, name: part.name, isSuperUser: isOwner });
          setCurrentUserId(part.id);
        }
      }
    } catch (err) {
      console.error('Error cargando datos:', err);
    }
    setLoading(false);
  };

  // ── Suscripciones Realtime ─────────────────────────────────
  useEffect(() => {
    if (!projectId) return undefined;
    const projectFilter = `project_id=eq.${projectId}`;
    const channel = supabase
      .channel(`productivity-plus-realtime-${projectId}`)

      // TASKS
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: projectFilter }, (payload) => {
        setTasks(prev => {
          if (prev.find(t => t.id === payload.new.id)) return prev;
          return [...prev, dbToTask(payload.new)].sort((a, b) => a.id - b.id);
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: projectFilter }, (payload) => {
        setTasks(prev => prev.map(t => t.id === payload.new.id ? dbToTask(payload.new) : t));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks', filter: projectFilter }, (payload) => {
        setTasks(prev => prev.filter(t => t.id !== payload.old.id));
      })

      // PARTICIPANTS
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'participants', filter: projectFilter }, (payload) => {
        setParticipants(prev => {
          if (prev.find(p => p.id === payload.new.id)) return prev;
          return [...prev, { id: payload.new.id, name: payload.new.name, isSuperUser: payload.new.is_super_user }];
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'participants', filter: projectFilter }, (payload) => {
        setParticipants(prev => prev.map(p =>
          p.id === payload.new.id ? { id: payload.new.id, name: payload.new.name, isSuperUser: payload.new.is_super_user } : p
        ));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'participants', filter: projectFilter }, (payload) => {
        setParticipants(prev => prev.filter(p => p.id !== payload.old.id));
      })

      // INDICATORS
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'indicators', filter: projectFilter }, (payload) => {
        setIndicators(prev => {
          if (prev.find(i => i.id === payload.new.id)) return prev;
          return [...prev, { id: payload.new.id, name: payload.new.name }];
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'indicators', filter: projectFilter }, (payload) => {
        setIndicators(prev => prev.filter(i => i.id !== payload.old.id));
      })

      // APP_CONFIG
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_config', filter: projectFilter }, (payload) => {
        const { key, value } = payload.new;
        if (key === 'nextId') setNextId(Number(value));
        if (key === 'currentUserId') setCurrentUserId(value === null ? null : Number(value));
      })

      // TASK_FIELD_DEFS — schema of custom card fields per project.
      // Treats soft-deleted rows (deleted_at NOT NULL) as removals so the
      // UI stays in sync without an extra query.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_field_defs', filter: projectFilter }, (payload) => {
        const row = payload.new;
        if (row.deleted_at) return;
        setTaskFieldDefs(prev => {
          if (prev.find(d => d.id === row.id)) return prev;
          return [...prev, row].sort((a, b) => (a.position - b.position) || (a.id - b.id));
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'task_field_defs', filter: projectFilter }, (payload) => {
        const row = payload.new;
        setTaskFieldDefs(prev => {
          const without = prev.filter(d => d.id !== row.id);
          if (row.deleted_at) return without;
          return [...without, row].sort((a, b) => (a.position - b.position) || (a.id - b.id));
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'task_field_defs', filter: projectFilter }, (payload) => {
        setTaskFieldDefs(prev => prev.filter(d => d.id !== payload.old.id));
      })

      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // Solo re-suscribir al cambiar de proyecto. Los setX provienen de hooks de
    // dominio (setters estables de useState); omitirlos es seguro y preserva el
    // comportamiento original (cuando vivían como useState directo en App).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return {
    projectId, setProjectId,
    project, setProject,
    currentUserId, setCurrentUserId,
    loading, setLoading,
    okrs, setOkrs,
    keyResults, setKeyResults,
    sprints, setSprints,
    participants, setParticipants,
    indicators, setIndicators,
    taskTypes, setTaskTypes,
    dimensions, setDimensions,
    saveParticipants, saveIndicators, saveTaskTypes, saveDimensions, saveProjectPin,
    taskFieldDefs, setTaskFieldDefs,
    hasCustomFieldsSchema,
    addTaskFieldDef, updateTaskFieldDefById, deleteTaskFieldDef, reorderTaskFieldDefs,
    tasks, setTasks, nextId, setNextId,
    createTask, updateTask, deleteTask, exportCSV,
    loadAllForProject,
  };
}
