import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. Copiá .env.example a .env y completalas."
  );
}

// La anon key es pública por diseño: no da acceso a nada por sí sola. Quien
// decide qué se puede leer y escribir son las políticas RLS de la base, que
// exigen que el email del token esté en admin_users.
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const ASSETS_URL = import.meta.env.VITE_ASSETS_URL ?? "";
