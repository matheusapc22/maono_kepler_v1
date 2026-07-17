import React, { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import Logo from "../assets/images/Logo_Maono.png";
import { useSession } from "../auth/session";

const LOGIN_BACKGROUND_URL =
  "https://pub-56c14c350e6c453c98cb6275d38db861.r2.dev/Piramides_Maono.png";

const ASSET_PRELOAD_TIMEOUT_MS = 4000;

function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }

    const image = new Image();

    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;

    if (image.complete) {
      resolve();
    }
  });
}

const LoginPage: React.FC = () => {
  const { authenticated, loading, login } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [assetsReady, setAssetsReady] = useState(false);

  const next = searchParams.get("next") || "/projects";

  useEffect(() => {
    if (!loading && authenticated) {
      navigate(next, { replace: true });
    }
  }, [authenticated, loading, navigate, next]);

  useEffect(() => {
    let active = true;

    const timeout = new Promise<void>((resolve) => {
      window.setTimeout(resolve, ASSET_PRELOAD_TIMEOUT_MS);
    });

    Promise.race([
      Promise.all([
        preloadImage(Logo),
        preloadImage(LOGIN_BACKGROUND_URL),
      ]).then(() => undefined),
      timeout,
    ]).finally(() => {
      if (active) {
        setAssetsReady(true);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await login(email, password);
      navigate(next, { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Não foi possível fazer login.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!assetsReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#202022] px-5 text-white">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-[#F2C766]" />
          <p className="text-sm font-semibold tracking-wide text-white/60">
            Carregando experiência Maõno...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="maono-login-page flex min-h-screen items-center justify-center overflow-hidden bg-[#202022] px-5 py-10 text-white">
      <style>
        {`
          .maono-login-page,
          .maono-login-page * {
            box-sizing: border-box;
          }

          .maono-login-page__card {
            position: relative;
            display: block !important;
            width: min(100%, 1180px);
            min-height: 620px;
            overflow: hidden;
            isolation: isolate;
            border-radius: 1.65rem;
            background:
              linear-gradient(
                90deg,
                rgba(5, 5, 7, 0.98) 0%,
                rgba(5, 5, 7, 0.9) 22%,
                rgba(5, 5, 7, 0.36) 48%,
                rgba(5, 5, 7, 0.08) 100%
              ),
              url("${LOGIN_BACKGROUND_URL}")
                center / cover no-repeat;
            box-shadow: 0 28px 90px rgba(0, 0, 0, 0.45);
          }

          .maono-login-page__card::before {
            content: "";
            position: absolute;
            inset: 0;
            z-index: 1;
            background:
              radial-gradient(circle at 76% 28%, rgba(33, 82, 141, 0.24), transparent 24%),
              linear-gradient(
                0deg,
                rgba(5, 5, 7, 0.9) 0%,
                rgba(5, 5, 7, 0.18) 34%,
                rgba(5, 5, 7, 0) 62%
              );
            pointer-events: none;
          }

          .maono-login-page__content {
            position: relative;
            z-index: 20;
            display: flex;
            min-height: 620px;
            flex-direction: column;
            justify-content: center;
            padding: 2.5rem 3.5rem;
          }

          .maono-login-page__content--floating {
            position: relative;
            z-index: 20;
            min-height: calc(620px - 56px);
            width: min(390px, calc(100% - 56px));
            margin: 28px 0 28px 28px;
            padding: 40px 34px 34px;
            border-radius: 28px;
            background:
              linear-gradient(
                180deg,
                rgba(18, 18, 22, 0.92) 0%,
                rgba(8, 8, 12, 0.88) 100%
              );
            border: 1px solid rgba(255, 255, 255, 0.045);
            box-shadow:
              0 34px 80px rgba(0, 0, 0, 0.54),
              0 14px 30px rgba(0, 0, 0, 0.44),
              0 0 0 1px rgba(255, 255, 255, 0.025) inset,
              0 0 42px rgba(255, 255, 255, 0.025);
            backdrop-filter: blur(8px);
          }

          .maono-login-page__content--floating::before {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: 28px;
            pointer-events: none;
            background:
              linear-gradient(
                135deg,
                rgba(255, 255, 255, 0.055) 0%,
                rgba(255, 255, 255, 0.018) 18%,
                rgba(255, 255, 255, 0) 42%
              );
          }

          .maono-login-page__content--floating::after {
            content: "";
            position: absolute;
            left: 18px;
            right: 18px;
            bottom: -22px;
            height: 42px;
            border-radius: 999px;
            background: radial-gradient(
              ellipse at center,
              rgba(0, 0, 0, 0.34) 0%,
              rgba(0, 0, 0, 0.18) 48%,
              rgba(0, 0, 0, 0) 100%
            );
            filter: blur(12px);
            pointer-events: none;
            z-index: -1;
          }

          .maono-login-page__form {
            display: flex !important;
            flex-direction: column !important;
            align-items: stretch !important;
            justify-content: flex-start !important;
            flex-wrap: nowrap !important;
            gap: 1.75rem !important;
            width: 100% !important;
            max-width: 300px !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          .maono-login-page__field {
            display: block !important;
            width: 100% !important;
            min-width: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          .maono-login-page__field-label {
            display: block !important;
            margin: 0 0 0.5rem 0 !important;
            padding: 0 !important;
            font-size: 0.875rem !important;
            line-height: 1.25rem !important;
            font-weight: 700 !important;
            letter-spacing: 0.025em !important;
            color: #F2C766 !important;
            text-transform: lowercase !important;
          }

          .maono-login-page__input {
            appearance: none !important;
            -webkit-appearance: none !important;
            display: block !important;
            width: 100% !important;
            min-width: 0 !important;
            height: 48px !important;
            margin: 0 !important;
            padding: 0 1rem !important;
            border-radius: 0.5rem !important;
            border: 1px solid rgba(214, 168, 79, 0.16) !important;
            background: #28282b !important;
            color: #ffffff !important;
            -webkit-text-fill-color: #ffffff !important;
            caret-color: #F2C766 !important;
            font-size: 0.875rem !important;
            line-height: 1.25rem !important;
            outline: none !important;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
          }

          .maono-login-page__input:focus {
            border-color: rgba(242, 199, 102, 0.72) !important;
            background: #303034 !important;
            box-shadow:
              0 0 0 4px rgba(214, 168, 79, 0.12),
              0 0 22px rgba(214, 168, 79, 0.18),
              inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
          }

          .maono-login-page__password-control {
            position: relative;
            display: block;
            width: 100%;
          }

          .maono-login-page__password-control .maono-login-page__input {
            padding-right: 4rem !important;
          }

          .maono-login-page__password-toggle {
            appearance: none !important;
            -webkit-appearance: none !important;
            position: absolute !important;
            top: 50% !important;
            right: 0.75rem !important;
            z-index: 2 !important;
            display: inline-flex !important;
            height: 32px !important;
            align-items: center !important;
            justify-content: center !important;
            transform: translateY(-50%) !important;
            margin: 0 !important;
            padding: 0 0.35rem !important;
            border: 0 !important;
            border-radius: 0.35rem !important;
            background: transparent !important;
            color: rgba(242, 199, 102, 0.86) !important;
            -webkit-text-fill-color: rgba(242, 199, 102, 0.86) !important;
            box-shadow: none !important;
            font-size: 0.75rem !important;
            line-height: 1rem !important;
            font-weight: 700 !important;
            text-transform: lowercase !important;
            cursor: pointer !important;
          }

          .maono-login-page__password-toggle:hover {
            color: #ffffff !important;
            -webkit-text-fill-color: #ffffff !important;
          }

          .maono-login-page__link-row {
            display: flex !important;
            width: 100% !important;
            justify-content: flex-end !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          .maono-login-page__link-center {
            display: block !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0.25rem 0 0 0 !important;
            text-align: center !important;
          }

          .maono-login-page__link-button {
            appearance: none !important;
            -webkit-appearance: none !important;
            display: inline !important;
            width: auto !important;
            min-width: 0 !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            border-radius: 0 !important;
            background: transparent !important;
            color: #F2C766 !important;
            -webkit-text-fill-color: #F2C766 !important;
            box-shadow: none !important;
            font-size: 0.875rem !important;
            line-height: 1.25rem !important;
            font-weight: 600 !important;
            text-align: inherit !important;
            text-transform: lowercase !important;
            text-decoration: underline !important;
            text-decoration-color: rgba(214, 168, 79, 0.42) !important;
            text-underline-offset: 2px !important;
            cursor: pointer !important;
          }

          .maono-login-page__link-button:hover {
            color: #ffffff !important;
            -webkit-text-fill-color: #ffffff !important;
            text-decoration-color: rgba(242, 199, 102, 0.86) !important;
          }

          .maono-login-page__submit {
            appearance: none !important;
            -webkit-appearance: none !important;
            position: relative !important;
            display: flex !important;
            width: 100% !important;
            min-width: 0 !important;
            height: 48px !important;
            min-height: 48px !important;
            align-items: center !important;
            justify-content: center !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 1rem !important;
            border: 1px solid rgba(242, 199, 102, 0.72) !important;
            border-radius: 0.5rem !important;
            background:
              linear-gradient(135deg, rgba(255, 255, 255, 0.42) 0%, rgba(255, 255, 255, 0.08) 16%, transparent 32%),
              linear-gradient(90deg, #8A6A2F 0%, #D6A84F 28%, #F2C766 52%, #B8862E 75%, #F2C766 100%) !important;
            color: #08090B !important;
            -webkit-text-fill-color: #08090B !important;
            box-shadow:
              0 18px 44px rgba(214, 168, 79, 0.22),
              0 0 34px rgba(242, 199, 102, 0.16),
              inset 0 1px 0 rgba(255, 255, 255, 0.58),
              inset 0 -1px 0 rgba(80, 52, 11, 0.42) !important;
            font-size: 1rem !important;
            line-height: 1.5rem !important;
            font-weight: 900 !important;
            cursor: pointer !important;
            text-shadow: 0 1px 0 rgba(255, 255, 255, 0.22) !important;
            transition:
              filter 160ms ease,
              transform 160ms ease,
              box-shadow 160ms ease,
              opacity 160ms ease !important;
          }

          .maono-login-page__submit::before {
            content: "" !important;
            position: absolute !important;
            inset: -45% auto -45% -40% !important;
            width: 38% !important;
            transform: rotate(18deg) !important;
            background: linear-gradient(
              90deg,
              transparent 0%,
              rgba(255, 255, 255, 0.22) 42%,
              rgba(255, 255, 255, 0.68) 50%,
              rgba(255, 255, 255, 0.18) 58%,
              transparent 100%
            ) !important;
            transition: left 520ms ease !important;
          }

          .maono-login-page__submit:hover {
            filter: brightness(1.08) saturate(1.08) !important;
            transform: translateY(-1px) !important;
            box-shadow:
              0 22px 54px rgba(214, 168, 79, 0.3),
              0 0 44px rgba(242, 199, 102, 0.22),
              inset 0 1px 0 rgba(255, 255, 255, 0.68),
              inset 0 -1px 0 rgba(80, 52, 11, 0.48) !important;
          }

          .maono-login-page__submit:hover::before {
            left: 110% !important;
          }

          .maono-login-page__submit:disabled {
            cursor: not-allowed !important;
            opacity: 0.6 !important;
            transform: none !important;
          }

          @media (max-width: 767px) {
            .maono-login-page__card {
              max-width: 560px;
              min-height: auto;
              background-position: center bottom;
            }

            .maono-login-page__content {
              min-height: auto;
              padding: 2.5rem 2rem;
            }

            .maono-login-page__content--floating {
              min-height: auto;
              width: auto;
              margin: 0;
              padding: 2.5rem 2rem;
              border-radius: 0;
            }

            .maono-login-page__form {
              max-width: 100% !important;
            }
          }
        `}
      </style>

      <section className="maono-login-page__card">
        <div className="maono-login-page__content maono-login-page__content--floating">
          <div className="mb-10">
            <img
              src={Logo}
              alt="Maõno"
              className="mb-12 h-24 w-auto object-contain opacity-95"
            />

            <h1 className="text-4xl font-black tracking-[-0.045em] text-white sm:text-[2.6rem]">
              Faça seu login
            </h1>

            <p className="mt-4 max-w-xs text-base font-bold leading-7 text-white/55">
              Entre para acessar seus projetos, mapas e permissões da plataforma.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="maono-login-page__form">
            <label className="maono-login-page__field">
              <span className="maono-login-page__field-label">e-mail</span>

              <input
                className="maono-login-page__input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>

            <label className="maono-login-page__field">
              <span className="maono-login-page__field-label">senha</span>

              <span className="maono-login-page__password-control">
                <input
                  className="maono-login-page__input"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />

                <button
                  type="button"
                  className="maono-login-page__password-toggle"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? "ocultar" : "ver"}
                </button>
              </span>
            </label>

            <div className="maono-login-page__link-row">
              <button type="button" className="maono-login-page__link-button">
                esqueci minha senha
              </button>
            </div>

            {error && (
              <div className="w-full rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm leading-5 text-red-100 shadow-[0_0_0_1px_rgba(248,113,113,0.08)]">
                {error}
              </div>
            )}

            <button
              className="maono-login-page__submit"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Entrando..." : "Entrar"}
            </button>

            <div className="maono-login-page__link-center">
              <button type="button" className="maono-login-page__link-button">
                ainda não tenho uma conta
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
};

export default LoginPage;