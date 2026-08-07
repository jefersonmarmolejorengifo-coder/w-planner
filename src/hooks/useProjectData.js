import { useState, useEffect, useRef } from "react";
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
  // El canal realtime se suscribe una vez por proyecto; estas refs le dejan
  // leer el estado más reciente al recargar tras un corte, sin tener que
  // re-suscribirse cada vez que cambia `project` o el usuario.
  const projectRef = useRef(null);
  const authUserRef = useRef(null);
  const huboCorteRef = useRef(false);
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
    projectRef.current = proj || projectRef.current;
    authUserRef.current = authUser || authUserRef.current;
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
      // Se destructura el `error` de TODAS, no solo de fieldDefs: supabase-js no
      // lanza, devuelve { error }. Sin mirarlo, una consulta que falla dejaba
      // `data` en undefined, el `if (tasksData)` se saltaba el setState, y la
      // carga terminaba "bien": tablero vacío —o peor, con los datos del
      // proyecto anterior al cambiar de tablero— sin una sola línea de aviso.
      const [
        { data: tasksData, error: tasksErr },
        { data: partsData, error: partsErr },
        { data: indsData, error: indsErr },
        { data: typesData, error: typesErr },
        { data: configData, error: configErr },
        { data: okrsData, error: okrsErr },
        { data: sprintsData, error: sprintsErr },
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

      // Un fallo parcial de carga tiene que verse. No abortamos —lo que sí
      // llegó es utilizable— pero deja de ser invisible.
      const fallos = [
        ['tareas', tasksErr], ['participantes', partsErr], ['indicadores', indsErr],
        ['tipos de tarea', typesErr], ['configuración', configErr],
        ['OKRs', okrsErr], ['sprints', sprintsErr],
      ].filter(([, e]) => e);
      if (fallos.length) {
        console.error('[loadAllForProject] no se pudieron cargar:',
          fallos.map(([n, e]) => `${n}: ${e.message}`).join(' | '));
      }

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
        // Sin este else, al abrir un tablero SIN OKRs los key results del
        // tablero anterior seguían en memoria: el selector "Resultado clave"
        // de una tarea nueva ofrecía KRs de otro proyecto y el vínculo cruzado
        // se guardaba sin error (la FK no valida que compartan proyecto).
        if (!okrsData.length) setKeyResults([]);
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
        const { data: createdDefault, error: defaultErr } = await supabase
          .from('participants')
          .insert({ name: 'Usuario', is_super_user: true, project_id: pid })
          .select()
          .single();
        // Solo el dueño puede crear fichas sin auth_user_id (policy
        // participants_owner_all); para un invitado esto se deniega y es
        // esperado, porque justo debajo se crea su ficha propia.
        if (defaultErr) console.warn('[loadAllForProject] no se creó el participante por defecto:', defaultErr.message);
        if (createdDefault) setParticipants([{ id: createdDefault.id, name: createdDefault.name, isSuperUser: true }]);
      }

      // Auto-set active user from auth
      if (authUser && pid) {
        const userName = authUser.user_metadata?.full_name || authUser.email.split('@')[0];
        const isOwner = (proj || p)?.owner_id === authUser.id;
        let part = partsData?.find(p2 => p2.auth_user_id === authUser.id || (p2.email && p2.email === authUser.email));
        if (!part) {
          // ESTE insert es el que dejó el producto medio mudo durante tres
          // meses: fallaba con 23502 (participants.id no tenía DEFAULT), su
          // error se ignoraba, `part` quedaba undefined y activeUser nunca se
          // fijaba. Sin activeUser no se escribe task_history NI
          // last_modified_by: 534 tareas, 0 filas de historial, 0 sellos de
          // autor. La columna ya se arregló; el error deja de ignorarse.
          const { data: created, error: createErr } = await supabase.from('participants').insert({
            name: userName, is_super_user: isOwner, project_id: pid,
            auth_user_id: authUser.id, email: authUser.email
          }).select().single();
          if (createErr) {
            console.error('[loadAllForProject] no se pudo registrar al usuario como participante; se queda sin usuario activo (sin historial ni sello de autor):', createErr);
            // 23505: otra pestaña ganó la carrera. La ficha existe: se relee.
            if (createErr.code === '23505') {
              const { data: existente } = await supabase.from('participants')
                .select('*').eq('project_id', pid).eq('auth_user_id', authUser.id).maybeSingle();
              if (existente) part = existente;
            }
          }
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

  // Un solo mapeo de fila de participante, para que los eventos realtime no
  // devuelvan un objeto más pobre que el de la carga inicial.
  const mapaParticipante = (fila) => ({
    id: fila.id,
    name: fila.name,
    isSuperUser: fila.is_super_user,
    isLegacy: fila.is_legacy === true,
    authUserId: fila.auth_user_id || null,
  });

  // ── Suscripciones Realtime ─────────────────────────────────
  useEffect(() => {
    if (!projectId) return undefined;
    const projectFilter = `project_id=eq.${projectId}`;
    const channel = supabase
      .channel(`productivity-plus-realtime-${projectId}`)

      // TASKS
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: projectFilter }, (payload) => {
        setTasks(prev => {
          const fresca = dbToTask(payload.new);
          // Si ya la tenemos, la REEMPLAZAMOS en vez de descartar el eco.
          // createTask añade la tarea local sin `updatedAt` (no hace .select()),
          // así que descartar el eco dejaba a toda tarjeta creada en la sesión
          // sin ese sello: en su primera edición el guard de concurrencia H-016
          // se omitía y un "0 filas afectadas" se tomaba por éxito.
          if (prev.find(t => t.id === fresca.id)) {
            return prev.map(t => t.id === fresca.id ? fresca : t);
          }
          return [...prev, fresca].sort((a, b) => a.id - b.id);
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: projectFilter }, (payload) => {
        setTasks(prev => {
          const fresca = dbToTask(payload.new);
          // Si no la tenemos (su INSERT se perdió en un hueco de conexión),
          // se añade en vez de descartar el evento: si no, esa tarjeta no
          // existiría para este usuario aunque siga recibiendo sus updates.
          if (!prev.some(t => t.id === fresca.id)) {
            return [...prev, fresca].sort((a, b) => a.id - b.id);
          }
          return prev.map(t => t.id === fresca.id ? fresca : t);
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks', filter: projectFilter }, (payload) => {
        setTasks(prev => prev.filter(t => t.id !== payload.old.id));
      })

      // PARTICIPANTS
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'participants', filter: projectFilter }, (payload) => {
        setParticipants(prev => {
          if (prev.find(p => p.id === payload.new.id)) return prev;
          // Mapeo completo: quedarse solo con {id, name, isSuperUser} borraba
          // isLegacy y authUserId, y en Configuración los participantes
          // ficticios saltaban a la lista de reales hasta recargar.
          return [...prev, mapaParticipante(payload.new)];
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'participants', filter: projectFilter }, (payload) => {
        setParticipants(prev => prev.map(p =>
          p.id === payload.new.id ? mapaParticipante(payload.new) : p
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

      .subscribe((estado) => {

        // Cuando el websocket se cae (suspensión del portátil, cambio de red),

        // supabase-js vuelve a unirse al canal PERO los eventos del hueco no se

        // reenvían: sin esto, el tablero se quedaba desactualizado para siempre en

        // esa sesión, sin ningún indicio. Al recuperar la suscripción tras un

        // fallo, se recarga todo.

        if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT' || estado === 'CLOSED') {

          huboCorteRef.current = true;

          return;

        }

        if (estado === 'SUBSCRIBED' && huboCorteRef.current) {

          huboCorteRef.current = false;

          console.warn('[realtime] canal recuperado tras un corte: recargando el tablero para no quedar desincronizado');

          loadAllForProject(projectId, projectRef.current, authUserRef.current);

        }

      });

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
