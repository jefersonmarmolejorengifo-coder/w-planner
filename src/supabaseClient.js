import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Falla rápido y con un mensaje claro si falta configuración (H-005), en lugar
// de crear un cliente con `undefined` que produce errores opacos más adelante.
if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Faltan variables de entorno del frontend: VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY. " +
    "Cópialas desde .env.example a tu .env.local."
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
