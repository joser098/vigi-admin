import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type Estado = "cargando" | "sin-sesion" | "no-autorizado" | "listo";

type AuthValue = {
  estado: Estado;
  session: Session | null;
  email: string | null;
  nombre: string | null;
  salir: () => Promise<void>;
};

const AuthContext = createContext<AuthValue>({
  estado: "cargando",
  session: null,
  email: null,
  nombre: null,
  salir: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [session, setSession] = useState<Session | null>(null);
  const [nombre, setNombre] = useState<string | null>(null);

  // Tener sesión no alcanza: cualquiera puede pedir un magic link con su
  // correo. Lo que autoriza es estar en admin_users, y eso lo decide la base.
  // La política deja ver solo la fila propia, así que si no vuelve nada, no
  // está en la whitelist.
  const verificarWhitelist = async (s: Session | null) => {
    if (!s) {
      setEstado("sin-sesion");
      return;
    }

    const { data, error } = await supabase
      .from("admin_users")
      .select("email, name")
      .maybeSingle();

    if (error || !data) {
      setEstado("no-autorizado");
      return;
    }

    setNombre(data.name ?? null);
    setEstado("listo");
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      verificarWhitelist(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => {
      setSession(s);
      verificarWhitelist(s);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const salir = async () => {
    await supabase.auth.signOut();
    setNombre(null);
  };

  return (
    <AuthContext.Provider
      value={{ estado, session, email: session?.user?.email ?? null, nombre, salir }}
    >
      {children}
    </AuthContext.Provider>
  );
};
