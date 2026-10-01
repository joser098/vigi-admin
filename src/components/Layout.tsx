import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/ordenes", label: "Órdenes" },
  { to: "/productos", label: "Productos" },
  { to: "/importar", label: "Importar" },
  { to: "/envios", label: "Envíos" },
  { to: "/pagos", label: "Pagos" },
  { to: "/clientes", label: "Clientes" },
  { to: "/carritos", label: "Carritos" },
  { to: "/cupones", label: "Cupones" },
  { to: "/email", label: "Email" },
  { to: "/meli", label: "MercadoLibre" },
];

const Layout = () => {
  const { email, nombre, salir } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <img src="/vigi.svg" alt="VIGI" className="h-6" />
            <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Admin
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm transition ${
                    isActive
                      ? "bg-neutral-100 font-medium text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-900"
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-neutral-500 sm:block">
              {nombre ?? email}
            </span>
            <button
              onClick={salir}
              className="text-xs text-neutral-500 transition hover:text-neutral-900"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;
