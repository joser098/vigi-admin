import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { money, number, monthLabel } from "@/lib/format";
import { PageTitle, Stat, Loading, ErrorBox } from "@/components/ui";

type Mes = { month: string; orders: number; revenue: number; avg_ticket: number };
type ProductoVendido = { month: string; name: string; units: number; revenue: number };
type Salud = {
  total: number; activos: number; sin_foto: number;
  en_promocion: number; con_precio_manual: number; sin_costo: number;
};

const mesActual = () => new Date().toISOString().slice(0, 7);

const Dashboard = () => {
  const [meses, setMeses] = useState<Mes[]>([]);
  const [productos, setProductos] = useState<ProductoVendido[]>([]);
  const [salud, setSalud] = useState<Salud | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [m, p, s] = await Promise.all([
        supabase.from("admin_sales_by_month").select("*").order("month"),
        supabase.from("admin_product_sales").select("*"),
        supabase.from("admin_catalogue_health").select("*").maybeSingle(),
      ]);

      const err = m.error ?? p.error ?? s.error;
      if (err) setError(err.message);

      setMeses((m.data ?? []) as Mes[]);
      setProductos((p.data ?? []) as ProductoVendido[]);
      setSalud((s.data ?? null) as Salud | null);
      setCargando(false);
    })();
  }, []);

  if (cargando) return <Loading />;

  const actual = mesActual();
  const delMes = meses.find((m) => String(m.month).slice(0, 7) === actual);

  const historico = meses.reduce(
    (acc, m) => ({ ordenes: acc.ordenes + Number(m.orders), total: acc.total + Number(m.revenue) }),
    { ordenes: 0, total: 0 }
  );

  // Top del mes corriente; si el mes todavía no tuvo ventas, se muestra el histórico.
  const delMesProds = productos.filter((p) => String(p.month).slice(0, 7) === actual);
  const base = delMesProds.length > 0 ? delMesProds : productos;
  const top = Object.values(
    base.reduce<Record<string, { name: string; units: number; revenue: number }>>((acc, p) => {
      acc[p.name] ??= { name: p.name, units: 0, revenue: 0 };
      acc[p.name].units += Number(p.units);
      acc[p.name].revenue += Number(p.revenue);
      return acc;
    }, {})
  ).sort((a, b) => b.units - a.units).slice(0, 8);

  const grafico = meses.slice(-12).map((m) => ({
    mes: monthLabel(String(m.month).slice(0, 7)),
    total: Number(m.revenue),
  }));

  return (
    <>
      <PageTitle>Dashboard</PageTitle>

      {error && <div className="mb-6"><ErrorBox>{error}</ErrorBox></div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Ventas del mes"
          value={money(delMes?.revenue ?? 0)}
          hint={`${number(delMes?.orders ?? 0)} órdenes`}
        />
        <Stat
          label="Ticket promedio"
          value={money(delMes?.avg_ticket ?? 0)}
          hint="mes corriente"
        />
        <Stat
          label="Histórico"
          value={money(historico.total)}
          hint={`${number(historico.ordenes)} órdenes en total`}
        />
        <Stat
          label="Catálogo"
          value={number(salud?.activos ?? 0)}
          hint={`${number(salud?.sin_foto ?? 0)} sin foto`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <section className="card p-5 lg:col-span-3">
          <h2 className="mb-4 text-sm font-medium">Ventas por mes</h2>
          {grafico.length === 0 ? (
            <p className="py-12 text-center text-sm text-neutral-400">
              Todavía no hay ventas registradas.
            </p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={grafico} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#a3a3a3" }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#a3a3a3" }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                  />
                  <Tooltip
                    formatter={(v: number) => [money(v), "Ventas"]}
                    contentStyle={{ borderRadius: 8, border: "1px solid #e5e5e5", fontSize: 12 }}
                  />
                  <Bar dataKey="total" fill="#1E053F" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-medium">
            Más vendidos
            <span className="ml-2 font-normal text-neutral-400">
              {delMesProds.length > 0 ? "este mes" : "histórico"}
            </span>
          </h2>
          {top.length === 0 ? (
            <p className="py-12 text-center text-sm text-neutral-400">Sin datos todavía.</p>
          ) : (
            <ul className="space-y-3">
              {top.map((p) => (
                <li key={p.name} className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm text-neutral-700" title={p.name}>
                    {p.name}
                  </span>
                  <span className="tabular shrink-0 text-sm font-medium">
                    {number(p.units)}
                    <span className="ml-1 text-xs font-normal text-neutral-400">u.</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {salud && (
        <section className="mt-6 card p-5">
          <h2 className="mb-4 text-sm font-medium">Estado del catálogo</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Total", salud.total],
              ["Activos", salud.activos],
              ["Sin foto", salud.sin_foto],
              ["En promoción", salud.en_promocion],
              ["Precio manual", salud.con_precio_manual],
              ["Sin costo", salud.sin_costo],
            ].map(([label, valor]) => (
              <div key={String(label)}>
                <p className="text-xs text-neutral-500">{label}</p>
                <p className="tabular mt-0.5 text-lg font-semibold">{number(valor as number)}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
};

export default Dashboard;
