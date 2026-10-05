import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Íconos
// ---------------------------------------------------------------------------
//
// Trazos de 24×24 al estilo Lucide, inline como el resto de los SVG del panel:
// once íconos no justifican una dependencia.

const Icono = ({ children }: { children: ReactNode }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="shrink-0"
  >
    {children}
  </svg>
);

const I = {
  dashboard: (
    <Icono>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Icono>
  ),
  ordenes: (
    <Icono>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </Icono>
  ),
  pagos: (
    <Icono>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </Icono>
  ),
  clientes: (
    <Icono>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Icono>
  ),
  carritos: (
    <Icono>
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </Icono>
  ),
  productos: (
    <Icono>
      <path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z" />
      <circle cx="7.5" cy="7.5" r="1" />
    </Icono>
  ),
  importar: (
    <Icono>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </Icono>
  ),
  envios: (
    <Icono>
      <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
      <path d="M15 18H9" />
      <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
      <circle cx="17" cy="18" r="2" />
      <circle cx="7" cy="18" r="2" />
    </Icono>
  ),
  cupones: (
    <Icono>
      <path d="M19 5 5 19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </Icono>
  ),
  email: (
    <Icono>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </Icono>
  ),
  meli: (
    <Icono>
      <path d="m2 7 2-4h16l2 4" />
      <path d="M2 7h20v2a3 3 0 0 1-5 2.24A3 3 0 0 1 12 11a3 3 0 0 1-5 .24A3 3 0 0 1 2 9Z" />
      <path d="M4 12v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8" />
      <path d="M10 21v-5h4v5" />
    </Icono>
  ),
  reventa: (
    <Icono>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </Icono>
  ),
  salir: (
    <Icono>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Icono>
  ),
  menu: (
    <Icono>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icono>
  ),
  cerrar: (
    <Icono>
      <path d="M18 6 6 18M6 6l12 12" />
    </Icono>
  ),
};

// ---------------------------------------------------------------------------
// Secciones, agrupadas por lo que tocan
// ---------------------------------------------------------------------------

type Item = { to: string; label: string; icono: ReactNode; end?: boolean };

const grupos: Array<{ titulo: string | null; items: Item[] }> = [
  { titulo: null, items: [{ to: "/", label: "Dashboard", icono: I.dashboard, end: true }] },
  {
    titulo: "Ventas",
    items: [
      { to: "/ordenes", label: "Órdenes", icono: I.ordenes },
      { to: "/pagos", label: "Pagos", icono: I.pagos },
      { to: "/clientes", label: "Clientes", icono: I.clientes },
      { to: "/carritos", label: "Carritos", icono: I.carritos },
    ],
  },
  {
    titulo: "Catálogo",
    items: [
      { to: "/productos", label: "Productos", icono: I.productos },
      { to: "/importar", label: "Importar precios", icono: I.importar },
      { to: "/envios", label: "Envíos", icono: I.envios },
    ],
  },
  {
    titulo: "Marketing",
    items: [
      { to: "/cupones", label: "Cupones", icono: I.cupones },
      { to: "/email", label: "Email", icono: I.email },
    ],
  },
  {
    titulo: "Canales",
    items: [
      { to: "/meli", label: "MercadoLibre", icono: I.meli },
      { to: "/reventa", label: "Reventa", icono: I.reventa },
    ],
  },
];

const Marca = () => (
  <Link to="/" className="flex items-center gap-2">
    <img src="/vigi.svg" alt="VIGI" className="h-7" />
    <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
      Admin
    </span>
  </Link>
);

const Navegacion = () => (
  <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
    {grupos.map((g, n) => (
      <div key={g.titulo ?? n}>
        {g.titulo && (
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            {g.titulo}
          </p>
        )}
        <div className="space-y-0.5">
          {g.items.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-[7px] text-sm transition ${
                  isActive
                    ? "bg-primary/[0.07] font-medium text-primary"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                }`
              }
            >
              {l.icono}
              {l.label}
            </NavLink>
          ))}
        </div>
      </div>
    ))}
  </nav>
);

const Layout = () => {
  const { email, nombre, salir } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const { pathname } = useLocation();

  // En el celular, la barra se cierra sola al entrar a una sección.
  useEffect(() => setAbierto(false), [pathname]);

  const barra = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between border-b border-neutral-200 px-5">
        <Marca />
        <button
          onClick={() => setAbierto(false)}
          className="text-neutral-400 hover:text-neutral-700 lg:hidden"
          aria-label="Cerrar menú"
        >
          {I.cerrar}
        </button>
      </div>

      <Navegacion />

      <div className="border-t border-neutral-200 p-3">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold uppercase text-white">
            {(nombre ?? email ?? "?").slice(0, 1)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-800">{nombre ?? "Admin"}</p>
            {email && <p className="truncate text-xs text-neutral-400">{email}</p>}
          </div>
          <button
            onClick={salir}
            title="Salir"
            aria-label="Salir"
            className="text-neutral-400 transition hover:text-neutral-800"
          >
            {I.salir}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Escritorio: fija a la izquierda. */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r border-neutral-200 bg-white lg:block">
        {barra}
      </aside>

      {/* Celular y tablet: barra arriba y menú deslizable. */}
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white/90 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setAbierto(true)} className="text-neutral-600" aria-label="Abrir menú">
          {I.menu}
        </button>
        <Marca />
      </header>

      {abierto && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setAbierto(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">{barra}</aside>
        </div>
      )}

      <main className="lg:pl-60">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
