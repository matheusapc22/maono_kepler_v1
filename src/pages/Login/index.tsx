import React, { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { login } from "../../lib/api";
import { useSession } from "../../hooks/useSession";

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session.loading && session.authenticated) {
      navigate("/projects", { replace: true });
    }
  }, [session.loading, session.authenticated, navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      await login(email, password);
      navigate("/projects", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao entrar.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#111827] text-white flex items-center justify-center p-6">
      <section className="w-full max-w-md rounded-2xl bg-[#1f2937] shadow-2xl border border-white/10 p-8">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.3em] text-yellow-400">Maõno</p>
          <h1 className="text-3xl font-semibold mt-2">Acesso à plataforma</h1>
          <p className="text-sm text-gray-300 mt-2">
            Entre para visualizar os projetos liberados para sua conta.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block">
            <span className="block text-sm text-gray-300 mb-2">E-mail</span>
            <input
              className="w-full rounded-lg bg-[#111827] border border-white/10 px-4 py-3 outline-none focus:border-yellow-400"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="block">
            <span className="block text-sm text-gray-300 mb-2">Senha</span>
            <input
              className="w-full rounded-lg bg-[#111827] border border-white/10 px-4 py-3 outline-none focus:border-yellow-400"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <button
            className="w-full rounded-lg bg-yellow-500 text-[#111827] font-semibold px-4 py-3 hover:bg-yellow-400 disabled:opacity-60"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
};

export default LoginPage;
