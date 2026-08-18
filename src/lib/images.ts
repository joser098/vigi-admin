import { supabase, ASSETS_URL } from "./supabase";

// Mismas reglas que la tienda para armar las rutas de imagen.
export const urlModel = (m: string) => encodeURIComponent(m).replace(/%20/g, "+");

export const galleryUrl = (model: string, i: number) =>
  `${ASSETS_URL}/gallery/${urlModel(model)}/${i}.png`;

export type ItemGaleria =
  | { id: string; tipo: "existente"; indice: number; preview: string }
  | { id: string; tipo: "nueva"; archivo: File; preview: string };

// Le manda a la Edge Function el estado final completo de la galería. Ella
// reescribe 0.png, 1.png… y actualiza thumbnail y gallery en la base.
export const guardarGaleria = async (model: string, items: ItemGaleria[]) => {
  const form = new FormData();
  form.append("model", model);

  const orden = items.map((it) =>
    it.tipo === "existente"
      ? { tipo: "existente", indice: it.indice }
      : { tipo: "nueva", archivo: -1 }
  );

  let n = 0;
  items.forEach((it, i) => {
    if (it.tipo === "nueva") {
      form.append(`file${n}`, it.archivo);
      (orden[i] as { archivo: number }).archivo = n;
      n++;
    }
  });

  form.append("orden", JSON.stringify(orden));

  const { data: sesion } = await supabase.auth.getSession();
  const token = sesion.session?.access_token;
  if (!token) throw new Error("Sesión vencida. Volvé a entrar.");

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/product-images`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `Error ${r.status} al guardar las imágenes`);

  return body as { total: number; thumbnail: string | null };
};
