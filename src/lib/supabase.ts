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

/**
 * Trae una tabla entera, de a mil filas.
 *
 * PostgREST devuelve **como máximo 1000 filas** por respuesta y no avisa: una
 * lista de 1200 contactos vuelve con 1000 y parece completa. Donde eso importa
 * —contactos, envíos— hay que pedir por páginas.
 *
 * `armar` devuelve la consulta ya filtrada para ese tramo; acá solo se repite
 * hasta que una página vuelve corta.
 *
 *     const contactos = await traerTodo<MarketingContact>((desde, hasta) =>
 *       supabase.from("marketing_contacts").select("*").range(desde, hasta)
 *     );
 */
export const PAGINA_SUPABASE = 1000;

export const traerTodo = async <T>(
  armar: (
    desde: number,
    hasta: number
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> => {
  const filas: T[] = [];

  for (let desde = 0; ; desde += PAGINA_SUPABASE) {
    const { data, error } = await armar(desde, desde + PAGINA_SUPABASE - 1);
    if (error) throw new Error(error.message);

    const pagina = (data ?? []) as T[];
    filas.push(...pagina);

    if (pagina.length < PAGINA_SUPABASE) return filas;
  }
};
