import { useState } from "react";
import { supabase } from "../lib/supabase";
import { money, dateTime } from "../lib/format";
import { meliSearchUrl } from "../lib/meli";
import { Badge } from "./ui";

type Datos = {
  meli_price: number | null;
  meli_url: string | null;
  meli_checked_at: string | null;
};

/**
 * Precio de referencia de MercadoLibre.
 *
 * No se trae solo: la API de búsqueda de MercadoLibre está cerrada y responde
 * 403 aun con un token válido, por política de ellos. El botón abre el listado
 * ya buscado y el precio se carga acá — un clic y un número, en vez de armar la
 * búsqueda a mano cada vez.
 */
export const MeliPrice = ({
  productId,
  model,
  provider,
  nuestroPrecio,
  inicial,
}: {
  productId: string;
  model: string;
  provider: string | null;
  nuestroPrecio: number | null;
  inicial: Datos;
}) => {
  const [datos, setDatos] = useState<Datos>(inicial);
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const url = meliSearchUrl(model, provider);

  const guardar = async (precio: number | null) => {
    setGuardando(true);
    setError("");

    const fila = {
      meli_price: precio,
      meli_url: precio === null ? null : url,
      meli_checked_at: precio === null ? null : new Date().toISOString(),
    };

    const { error: err } = await supabase
      .from("products")
      .update(fila)
      .eq("id", productId);

    if (err) {
      setError(err.message);
    } else {
      setDatos(fila);
      setValor("");
    }

    setGuardando(false);
  };

  const confirmar = () => {
    // Se pega como viene de MercadoLibre: "141.700" o "141700".
    const limpio = valor.replace(/\./g, "").replace(",", ".").trim();
    const n = Number(limpio);

    if (!limpio || !Number.isFinite(n) || n <= 0) {
      setError("Escribí un precio válido.");
      return;
    }
    guardar(n);
  };

  // Cuánto más caros o baratos estamos. Es el dato por el que se mira esto.
  const diferencia =
    datos.meli_price && nuestroPrecio
      ? Math.round(((nuestroPrecio - datos.meli_price) / datos.meli_price) * 100)
      : null;

  return (
    <section className="card p-5">
      <h2 className="text-sm font-medium">Precio en MercadoLibre</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Abrí el listado, mirá el más barato que sea nuevo y de un vendedor
        serio, y cargalo acá.
      </p>

      <a
        href={url}
        target="_blank"
        rel="noopener"
        className="btn mt-4 inline-flex w-full items-center justify-center gap-2"
      >
        Buscar en MercadoLibre
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
        </svg>
      </a>

      <div className="mt-3 flex gap-2">
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && confirmar()}
          placeholder={datos.meli_price ? "Actualizar precio" : "Precio en MELI"}
          inputMode="decimal"
          className="input flex-1"
        />
        <button
          type="button"
          onClick={confirmar}
          disabled={guardando || !valor}
          className="btn shrink-0 disabled:opacity-50"
        >
          {guardando ? "…" : "Guardar"}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {datos.meli_price !== null ? (
        <div className="mt-4 border-t border-neutral-100 pt-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="tabular text-2xl font-medium">
              {money(datos.meli_price)}
            </span>
            {diferencia !== null && (
              <Badge tone={diferencia > 0 ? "red" : "green"}>
                {diferencia > 0
                  ? `estamos ${diferencia}% más caros`
                  : diferencia < 0
                    ? `estamos ${Math.abs(diferencia)}% más baratos`
                    : "mismo precio"}
              </Badge>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-neutral-400">
              Cargado el {dateTime(datos.meli_checked_at)}
            </p>
            <button
              type="button"
              onClick={() => guardar(null)}
              disabled={guardando}
              className="text-xs text-neutral-400 underline hover:text-neutral-700"
            >
              Borrar
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-4 border-t border-neutral-100 pt-4 text-xs text-neutral-500">
          Todavía no cargamos la referencia de este producto.
        </p>
      )}
    </section>
  );
};
