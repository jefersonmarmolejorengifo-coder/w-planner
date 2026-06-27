import { supabase } from '../supabaseClient';

// Intenta unir al usuario a un proyecto por código de invitación.
// Primero intenta el RPC join_project_by_invite_code; si no existe,
// hace el upsert manual en project_members.
// Retorna el proyecto si tuvo éxito, null si no encontró el código.
export const joinProjectByCode = async (code, user) => {
  const inviteCode = String(code || "").trim();
  if (!inviteCode) return null;

  const { data: joined, error: rpcError } = await supabase.rpc(
    "join_project_by_invite_code",
    { invite_code_input: inviteCode }
  );
  if (!rpcError && joined) return joined;

  const { data: proj } = await supabase.from('projects').select('*').eq('invite_code', inviteCode).single();
  if (!proj) return null;
  if (user) {
    await supabase.from('project_members').upsert(
      { project_id: proj.id, email: user.email, name: user.user_metadata?.full_name || user.email, user_id: user.id },
      { onConflict: 'project_id,email' }
    );
  }
  return proj;
};
