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
    <main className="flex min-h-screen items-center justify-center overflow-hidden bg-[#202022] px-5 py-10 text-white">
      <section className="relative grid min-h-[520px] w-full max-w-[980px] overflow-hidden rounded-[1.65rem] bg-[#050507] shadow-[0_28px_90px_rgba(0,0,0,0.45)] md:grid-cols-[0.92fr_1.58fr]">
        <div className="relative z-10 flex min-h-[520px] flex-col justify-center px-8 py-10 sm:px-12 md:px-14">
          <div className="mb-12">
            <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.42em] text-white/35">
              Maõno Maps
            </p>

            <h1 className="text-3xl font-extrabold tracking-[-0.04em] text-white sm:text-[2rem]">
              Faça o seu login{" "}
              <span className="inline-block h-3 w-3 rounded-full bg-gradient-to-br from-[#f8b95d] via-[#df44c8] to-[#6b5cff] align-middle shadow-[0_0_18px_rgba(223,68,200,0.75)]" />
            </h1>

            <p className="mt-3 max-w-xs text-sm leading-6 text-white/45">
              Entre para acessar seus projetos, mapas e permissões da
              plataforma.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-7">
            <label className="block">
              <span className="mb-2 block text-sm font-medium lowercase tracking-wide text-[#a9c7ef]">
                email
              </span>

              <input
                className="h-12 w-full rounded-lg border border-white/5 bg-[#28282b] px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#d74bd6]/70 focus:bg-[#303034] focus:ring-4 focus:ring-[#d74bd6]/10"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium lowercase tracking-wide text-[#a9c7ef]">
                senha
              </span>

              <input
                className="h-12 w-full rounded-lg border border-white/5 bg-[#28282b] px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#d74bd6]/70 focus:bg-[#303034] focus:ring-4 focus:ring-[#d74bd6]/10"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            <div className="flex justify-end">
              <button
                type="button"
                className="text-sm font-medium lowercase text-[#b7d4ff] underline decoration-white/30 underline-offset-2 transition hover:text-white"
              >
                esqueci minha senha
              </button>
            </div>

            {error && (
              <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm leading-5 text-red-100 shadow-[0_0_0_1px_rgba(248,113,113,0.08)]">
                {error}
              </div>
            )}

            <button
              className="h-12 w-full rounded-lg bg-gradient-to-r from-[#6f5cff] via-[#d943d4] to-[#ffbf66] px-4 text-base font-extrabold text-white shadow-[0_18px_40px_rgba(217,67,212,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Entrando..." : "Entrar"}
            </button>

            <div className="pt-1 text-center">
              <button
                type="button"
                className="text-sm font-medium lowercase text-[#b7d4ff] underline decoration-white/30 underline-offset-2 transition hover:text-white"
              >
                ainda não tenho uma conta
              </button>
            </div>
          </form>
        </div>

        <div className="relative hidden overflow-hidden md:block" aria-hidden="true">
          <div className="absolute inset-0 bg-[#07090f]" />

          <div
            className="absolute inset-0 opacity-95"
            style={{
              backgroundImage:
                "radial-gradient(circle at 78% 18%, rgba(124, 98, 255, 0.34), transparent 24%), radial-gradient(circle at 84% 32%, rgba(63, 170, 214, 0.34), transparent 22%), radial-gradient(circle at 64% 72%, rgba(76, 111, 148, 0.42), transparent 23%), linear-gradient(90deg, rgba(5,5,7,0.98) 0%, rgba(5,5,7,0.9) 14%, rgba(5,5,7,0.18) 48%, rgba(9,13,24,0.35) 100%)",
            }}
          />

          <div
            className="absolute inset-0 opacity-55"
            style={{
              backgroundImage:
                "radial-gradient(circle at 70% 16%, rgba(255,255,255,0.62) 0 1px, transparent 1.6px), radial-gradient(circle at 74% 20%, rgba(255,255,255,0.45) 0 1px, transparent 1.4px), radial-gradient(circle at 82% 12%, rgba(255,255,255,0.38) 0 1px, transparent 1.6px), radial-gradient(circle at 88% 28%, rgba(255,255,255,0.42) 0 1px, transparent 1.5px), radial-gradient(circle at 58% 24%, rgba(255,255,255,0.35) 0 1px, transparent 1.4px), radial-gradient(circle at 92% 42%, rgba(255,255,255,0.32) 0 1px, transparent 1.5px)",
            }}
          />

          <div className="absolute bottom-0 left-[18%] h-[165px] w-[520px] bg-[#111827] opacity-75 [clip-path:polygon(0_100%,18%_52%,30%_70%,43%_28%,55%_62%,68%_36%,83%_78%,100%_100%)]" />
          <div className="absolute bottom-0 left-[34%] h-[205px] w-[520px] bg-[#1f2937] opacity-85 [clip-path:polygon(0_100%,15%_62%,28%_76%,42%_30%,54%_66%,70%_24%,86%_72%,100%_100%)]" />
          <div className="absolute bottom-0 right-0 h-[120px] w-[430px] bg-[#0a0b10] opacity-90 [clip-path:polygon(0_100%,18%_54%,32%_80%,46%_40%,61%_74%,78%_48%,100%_100%)]" />

          <div className="absolute inset-y-0 left-0 w-44 bg-gradient-to-r from-[#050507] via-[#050507]/80 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#050507] via-[#050507]/55 to-transparent" />
        </div>
      </section>
    </main>
  );
};

export default LoginPage;