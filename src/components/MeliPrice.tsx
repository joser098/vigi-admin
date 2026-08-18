import { useState } from "react";
import { supabase } from "../lib/supabase";
import { money, dateTime } from "../lib/format";
import { Badge } from "./ui";

type Datos = {
  meli_price: number | null;
  meli_url: string | null;
  meli_title: string | null;
  meli_checked_at: string | null;
};

/**
 * Trae el precio de referencia de MercadoLibre para un producto y lo deja
 * guardado.
 *
 * Se consulta de a uno y a pedido: el catálogo son más de 500 productos y
 * traerlos todos cada vez sería castigar a MercadoLibre para mirar tres.
 */
export const MeliPrice = ({
  productId,
  nuestroPrecio,
  inicial,
}: {
  productId: string;
  nuestroPrecio: number | null;
  inicial: Datos;
}) => {
  const [datos, setDatos] = useState<Datos>(inicial);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [sinResultado, setSinResultado] = useState(false);

  const buscar = async () => {
    setBuscando(true);
    setError("");
    setSinResultado(false);

    const { data, error: err } = await supabase.functions.invoke("meli-price", {
      body: { product_id: productId },
    });

    if (err) {
      setError(err.message);
    } else if (data?.error) {
      setError(data.error);
    } else if (data?.found === false) {
      setSinResultado(true);
      setDatos({
        meli_price: null,
        meli_url: null,
        meli_title: null,
        meli_checked_at: new Date().toISOString(),
      });
    } else {
      setDatos({
        meli_price: data.meli_price,
        meli_url: data.meli_url,
        meli_title: data.meli_title,
        meli_checked_at: data.meli_checked_at,
      });
    }

    setBuscando(false);
  };

  // Cuánto más caros o baratos estamos. Es el dato por el que se mira esto.
  const diferencia =
    datos.meli_price && nuestroPrecio
      ? Math.round(((nuestroPrecio - datos.meli_price) / datos.meli_price) * 100)
      : null;

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">Precio en MercadoLibre</h2>
          <p className="mt-1 text-xs text-neutral-500">
            La publicación nueva más barata de un vendedor con reputación.
          </p>
        </div>
        <button
          type="button"
          onClick={buscar}
          disabled={buscando}
          className="btn shrink-0 disabled:opacity-50"
        >
          {buscando ? "Buscando…" : datos.meli_checked_at ? "Actualizar" : "Buscar precio"}
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {sinResultado && !error && (
        <p className="mt-4 text-xs text-neutral-500">
          No encontramos publicaciones nuevas de vendedores con reputación para
          este modelo. Puede que se publique con otro nombre.
        </p>
      )}

      {datos.meli_price !== null && !sinResultado && (
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-2xl font-medium tabular">
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

          {datos.meli_title && (
            <p className="mt-2 text-xs text-neutral-500">
              {datos.meli_url ? (
                <a
                  href={datos.meli_url}
                  target="_blank"
                  rel="noopener"
                  className="underline hover:text-neutral-800"
                >
                  {datos.meli_title}
                </a>
              ) : (
                datos.meli_title
              )}
            </p>
          )}
        </div>
      )}

      {datos.meli_checked_at && (
        <p className="mt-3 text-xs text-neutral-400">
          Consultado el {dateTime(datos.meli_checked_at)}
        </p>
      )}

      {!datos.meli_checked_at && !buscando && !error && (
        <p className="mt-4 text-xs text-neutral-500">
          Todavía no lo consultamos para este producto.
        </p>
      )}
    </section>
  );
};
