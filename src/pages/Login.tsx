import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

const Login = () => {
  const { estado, email: emailSesion, salir } = useAuth();
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError("");

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });

    setEnviando(false);

    if (error) {
      setError(error.message);
      return;
    }

    setEnviado(true);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-white">
            V
          </div>
          <h1 className="text-xl font-semibold tracking-tight">VIGI Admin</h1>
          <p className="mt-1 text-sm text-neutral-500">Panel interno</p>
        </div>

        {estado === "no-autorizado" ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-neutral-700">
              La cuenta <strong className="font-medium">{emailSesion}</strong> no
              tiene acceso al panel.
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              Pedí que agreguen tu correo a la lista de administradores.
            </p>
            <button onClick={salir} className="btn-ghost mt-5 w-full">
              Salir
            </button>
          </div>
        ) : enviado ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-neutral-700">
              Te mandamos un enlace de acceso a{" "}
              <strong className="font-medium">{email}</strong>.
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              Abrilo desde este mismo dispositivo. Vence en una hora.
            </p>
            <button
              onClick={() => { setEnviado(false); setEmail(""); }}
              className="btn-ghost mt-5 w-full"
            >
              Usar otro correo
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="card p-6">
            <label htmlFor="email" className="label">
              Correo
            </label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vos@vigi.cam"
              className="input"
            />

            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

            <button type="submit" disabled={enviando} className="btn-primary mt-4 w-full">
              {enviando ? "Enviando…" : "Enviar enlace de acceso"}
            </button>

            <p className="mt-4 text-center text-xs text-neutral-400">
              Sin contraseña. Solo correos autorizados.
            </p>
          </form>
        )}
      </div>
    </main>
  );
};

export default Login;
