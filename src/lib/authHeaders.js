import { supabase } from "../supabaseClient";

// Cabeceras JSON + Bearer del usuario autenticado para llamar a las funciones
// /api/*. Extraído del monolito (H-002) para compartirlo con los paneles que se
// separaron a src/features/.
export const getAuthJsonHeaders = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Debes iniciar sesión nuevamente.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
};
