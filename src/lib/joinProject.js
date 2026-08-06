import { supabase } from '../supabaseClient';

// Une al usuario autenticado a un proyecto usando su código de invitación.
//
// Devuelve SIEMPRE `{ project, error }` (nunca lanza):
//   · éxito       → { project: <fila de projects>, error: null }
//   · fallo       → { project: null, error: "<mensaje para el usuario>" }
//
// Por qué un objeto y no el proyecto a secas: la versión anterior devolvía
// `null` para cualquier fallo, así que la UI mostraba "código inválido" incluso
// cuando el servidor había reventado por otra razón. Eso escondió durante meses
// un error 23502 dentro del RPC (participants.id sin DEFAULT) y dejó a todos los
// invitados fuera sin ninguna pista en pantalla ni en la consola.

// Mensajes por SQLSTATE que el RPC join_project_by_invite_code() levanta a
// propósito. Cualquier otro código es un fallo real del servidor y se reporta
// como tal, no como "código inválido".
const RPC_ERROR_MESSAGES = {
  P0002: 'Código de invitación inválido. Pídele al dueño del tablero que te reenvíe la invitación.',
  28000: 'Tu sesión no está activa. Vuelve a iniciar sesión y abre de nuevo el enlace de invitación.',
};

// El RPC no existe todavía en esta base (migración sin aplicar).
const isMissingFunction = (error) =>
  error?.code === '42883' || /function .* does not exist/i.test(error?.message || '');

export const joinProjectByCode = async (code, user) => {
  const inviteCode = String(code || '').trim();
  if (!inviteCode) return { project: null, error: 'Ingresa el código de invitación.' };

  const { data: joined, error: rpcError } = await supabase.rpc(
    'join_project_by_invite_code',
    { invite_code_input: inviteCode }
  );

  if (!rpcError && joined) return { project: joined, error: null };

  if (rpcError && !isMissingFunction(rpcError)) {
    // Camino normal cuando algo falla: el RPC existe y nos dijo por qué.
    // Lo dejamos en consola con el SQLSTATE para poder diagnosticar sin
    // adivinar, y traducimos solo los códigos que son culpa del usuario.
    console.error('[joinProject] el RPC join_project_by_invite_code falló', {
      code: rpcError.code,
      message: rpcError.message,
      details: rpcError.details,
      hint: rpcError.hint,
    });
    return {
      project: null,
      error: RPC_ERROR_MESSAGES[rpcError.code]
        || `No pudimos unirte al tablero: el servidor rechazó la operación (${rpcError.code || 'sin código'}). Intenta de nuevo; si sigue igual, avisa al dueño del tablero.`,
    };
  }

  if (!rpcError && !joined) {
    // El RPC respondió vacío sin error: en la práctica solo pasa si el código
    // no corresponde a ningún proyecto.
    return { project: null, error: RPC_ERROR_MESSAGES.P0002 };
  }

  // Fallback SOLO para bases donde el RPC todavía no existe. Ojo: la RLS de
  // projects (projects_select_member) impide leer un proyecto del que aún no
  // eres miembro, así que este camino únicamente sirve para bases antiguas sin
  // RLS. No sustituye al RPC.
  const { data: proj, error: selectError } = await supabase
    .from('projects').select('*').eq('invite_code', inviteCode).maybeSingle();
  if (selectError || !proj) {
    console.error('[joinProject] RPC ausente y el fallback directo tampoco encontró el proyecto', selectError);
    return {
      project: null,
      error: 'No pudimos verificar el código de invitación. Falta aplicar una migración en el servidor.',
    };
  }

  if (user) {
    await supabase.from('project_members').upsert(
      {
        project_id: proj.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.email,
        user_id: user.id,
      },
      { onConflict: 'project_id,email' }
    );
  }
  return { project: proj, error: null };
};
