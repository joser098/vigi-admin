import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { money, number, date } from "@/lib/format";
import { PageTitle, Badge, Empty, Loading, ErrorBox } from "@/components/ui";
import type { Coupon } from "@/lib/types";

/**
 * Un cupón puede estar inactivo por cuatro motivos distintos y todos importan:
 * apagado a mano, todavía sin arrancar, vencido o agotado. Un solo badge de
 * "activo / inactivo" los taparía, y el que atiende el teléfono necesita saber
 * cuál de los cuatro es cuando un cliente llama diciendo que no le anda.
 */
export const estadoDe = (c: Coupon, ahora = new Date()) => {
  if (!c.is_active) return { label: "apagado", tone: "neutral" as const };

  if (c.starts_at && new Date(c.starts_at) > ahora)
    return { label: "programado", tone: "violet" as const };

  if (c.ends_at && new Date(c.ends_at) <= ahora)
    return { label: "vencido", tone: "red" as const };

  if (c.max_redemptions != null && c.redemptions >= c.max_redemptions)
    return { label: "agotado", tone: "red" as const };

  return { label: "activo", tone: "green" as const };
};

export const descuentoDe = (c: Coupon) =>
  c.kind === "percentage"
    ? `${Number(c.value)}%${c.max_discount ? ` (tope ${money(c.max_discount)})` : ""}`
    : money(c.value);

const Coupons = () => {
  const [cupones, setCupones] = useState<Coupon[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [soloVigentes, setSoloVigentes] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("coupons")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) setError(error.message);
      setCupones((data ?? []) as Coupon[]);
      setCargando(false);
    })();
  }, []);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();

    return cupones.filter((c) => {
      if (soloVigentes && estadoDe(c).label !== "activo") return false;
      if (!q) return true;

      return `${c.code} ${c.description ?? ""}`.toLowerCase().includes(q);
    });
  }, [cupones, busqueda, soloVigentes]);

  if (cargando) return <Loading />;

  return (
    <>
      <PageTitle
        action={
          <Link to="/cupones/nuevo" className="btn-primary">
            Nuevo cupón
          </Link>
        }
      >
        Cupones
      </PageTitle>

      {error && (
        <div className="mb-6">
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por código…"
          className="input max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={soloVigentes}
            onChange={(e) => setSoloVigentes(e.target.checked)}
          />
          Solo vigentes
        </label>
        <span className="ml-auto text-sm text-neutral-500">
          {number(filtrados.length)} cupones
        </span>
      </div>

      {filtrados.length === 0 ? (
        <Empty>
          {cupones.length === 0
            ? "Todavía no hay cupones. Creá el primero con “Nuevo cupón”."
            : "No hay cupones que coincidan."}
        </Empty>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-neutral-200 bg-neutral-50">
              <tr>
                <th className="th">Código</th>
                <th className="th">Descuento</th>
                <th className="th">Compra mínima</th>
                <th className="th">Vigencia</th>
                <th className="th">Estado</th>
                <th className="th text-right">Usos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtrados.map((c) => {
                const estado = estadoDe(c);

                return (
                  <tr key={c.id} className="transition hover:bg-neutral-50">
                    <td className="td">
                      <Link
                        to={`/cupones/${c.id}`}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {c.code}
                      </Link>
                      {c.description && (
                        <p className="text-xs text-neutral-400">{c.description}</p>
                      )}
                    </td>
                    <td className="td tabular">{descuentoDe(c)}</td>
                    <td className="td tabular">
                      {Number(c.min_purchase) > 0 ? money(c.min_purchase) : "—"}
                    </td>
                    <td className="td whitespace-nowrap text-neutral-500">
                      {c.starts_at || c.ends_at
                        ? `${c.starts_at ? date(c.starts_at) : "desde ya"} → ${
                            c.ends_at ? date(c.ends_at) : "sin fin"
                          }`
                        : "sin límite"}
                    </td>
                    <td className="td">
                      <Badge tone={estado.tone}>{estado.label}</Badge>
                    </td>
                    <td className="td tabular text-right font-medium">
                      {number(c.redemptions)}
                      {c.max_redemptions != null && (
                        <span className="text-neutral-400">
                          {" "}
                          / {number(c.max_redemptions)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

export default Coupons;
