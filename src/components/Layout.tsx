import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/ordenes", label: "Órdenes" },
  { to: "/productos", label: "Productos" },
  { to: "/cupones", label: "Cupones" },
];

const Layout = () => {
  const { email, nombre, salir } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">
              V
            </div>
            <span className="text-sm font-semibold tracking-tight">Admin</span>
          </div>

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
