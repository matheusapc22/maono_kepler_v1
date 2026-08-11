import React, { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";

import Logo from "../assets/images/Logo_Maono.png";
import { useSession } from "../auth/session";
import "./login.css";

const LOGIN_BACKGROUND_URL =
  "https://pub-56c14c350e6c453c98cb6275d38db861.r2.dev/Piramides_Maono.png";
const LOGIN_PAGE_BACKGROUND_URL = "/login-background-maono.webp";
const ASSET_PRELOAD_TIMEOUT_MS = 4_000;

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

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/projects";
  }

  return value;
}

function formField(form: HTMLFormElement, name: string) {
  return String(new FormData(form).get(name) ?? "");
}

const LoginPage: React.FC = () => {
  const { authenticated, loading, login } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [assetsReady, setAssetsReady] = useState(false);

  const next = safeNextPath(searchParams.get("next"));

  useEffect(() => {
    if (!loading && authenticated) {
      navigate(next, { replace: true });
    }
  }, [authenticated, loading, navigate, next]);

  useEffect(() => {
    let active = true;
    let timeoutId = 0;

    const timeout = new Promise<void>((resolve) => {
      timeoutId = window.setTimeout(resolve, ASSET_PRELOAD_TIMEOUT_MS);
    });

    Promise.race([
      Promise.all([
        preloadImage(Logo),
        preloadImage(LOGIN_BACKGROUND_URL),
        preloadImage(LOGIN_PAGE_BACKGROUND_URL),
      ]).then(() => undefined),
      timeout,
    ]).finally(() => {
      if (active) {
        setAssetsReady(true);
      }
    });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const email = formField(form, "email").trim().toLowerCase();
    const password = formField(form, "password");

    setError("");

    if (!email || !password) {
      setError("Informe e-mail e senha.");
      return;
    }

    setSubmitting(true);

    try {
      await login(email, password);
      navigate(next, { replace: true });
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível fazer login.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const pageStyle = {
    "--maono-login-background": `url("${LOGIN_BACKGROUND_URL}")`,
    // Usamos o shorthand inline para sobrescrever de forma inequívoca o
    // fallback `background` legado do CSS. O asset externo fica exclusivo da
    // viewport; a variável acima continua exclusiva do card com as pirâmides.
    background: `#050505 url("${LOGIN_PAGE_BACKGROUND_URL}") center / cover no-repeat`,
  } as CSSProperties;

  if (!assetsReady) {
    return (
      <main
        className="maono-login-page maono-login-page__loading"
        style={pageStyle}
        aria-busy="true"
      >
        <div className="maono-login-page__spinner" aria-hidden="true" />
        <p role="status">Carregando experiência Maõno...</p>
      </main>
    );
  }

  return (
    <main className="maono-login-page" style={pageStyle}>
      <section className="maono-login-page__card">
        <div className="maono-login-page__content maono-login-page__content--floating">
          <div className="maono-login-page__brand">
            <img
              src={Logo}
              alt="Maõno"
              className="maono-login-page__logo"
            />

            <h1>Faça seu login</h1>

            <p className="maono-login-page__intro">
              Entre para acessar seus projetos, mapas e permissões da
              plataforma.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="maono-login-page__form"
            autoComplete="on"
          >
            <label
              className="maono-login-page__field"
              htmlFor="maono-login-email"
            >
              <span className="maono-login-page__field-label">e-mail</span>

              <input
                id="maono-login-email"
                name="email"
                className="maono-login-page__input"
                type="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </label>

            <label
              className="maono-login-page__field"
              htmlFor="maono-login-password"
            >
              <span className="maono-login-page__field-label">senha</span>

              <span className="maono-login-page__password-control">
                <input
                  id="maono-login-password"
                  name="password"
                  className="maono-login-page__input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                />

                <button
                  type="button"
                  className="maono-login-page__password-toggle"
                  aria-label={
                    showPassword ? "Ocultar senha" : "Mostrar senha"
                  }
                  aria-pressed={showPassword}
                  onClick={() =>
                    setShowPassword((current) => !current)
                  }
                >
                  {showPassword ? "ocultar" : "ver"}
                </button>
              </span>
            </label>

            <div className="maono-login-page__link-row">
              <button
                type="button"
                className="maono-login-page__link-button"
              >
                esqueci minha senha
              </button>
            </div>

            {error ? (
              <div className="maono-login-page__error" role="alert">
                {error}
              </div>
            ) : null}

            <button
              className="maono-login-page__submit"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Entrando..." : "Entrar"}
            </button>

            <div className="maono-login-page__link-center">
              <button
                type="button"
                className="maono-login-page__link-button"
              >
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
