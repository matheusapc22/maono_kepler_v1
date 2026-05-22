import React, { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import Logo from "../assets/images/Logo_Maono.png";
import { useSession } from "../auth/session";

const LoginPage: React.FC = () => {
  const { authenticated, loading, login } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const next = searchParams.get("next") || "/projects";

  useEffect(() => {
    if (!loading && authenticated) {
      navigate(next, { replace: true });
    }
  }, [authenticated, loading, navigate, next]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await login(email, password);
      navigate(next, { replace: true });
    } catch (err: any) {
      setError(err?.message || "Não foi possível fazer login.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen w-full bg-[#0f172a] text-white flex items-center justify-center px-4">
      <section className="w-full max-w-md rounded-2xl bg-white/10 border border-white/10 shadow-2xl p-8 backdrop-blur">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src={Logo} alt="Maõno" className="h-20 w-auto object-contain" />
          <div className="text-center">
            <h1 className="text-2xl font-semibold">Acesse sua plataforma</h1>
            <p className="text-sm text-white/70 mt-1">
              Entre para visualizar os projetos liberados para sua conta.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm text-white/80">E-mail</span>
            <input
              className="mt-1 w-full rounded-xl border border-white/15 bg-white/95 px-4 py-3 text-slate-900 outline-none focus:ring-2 focus:ring-blue-400"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm text-white/80">Senha</span>
            <input
              className="mt-1 w-full rounded-xl border border-white/15 bg-white/95 px-4 py-3 text-slate-900 outline-none focus:ring-2 focus:ring-blue-400"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <div className="rounded-xl border border-red-300/40 bg-red-500/15 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-blue-500 px-4 py-3 font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
};

export default LoginPage;