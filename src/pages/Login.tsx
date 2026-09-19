import React, { useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";

import LoginPageBackground from "../assets/images/login-background-maono.webp";
import Logo from "../assets/images/Logo_Maono.png";
import { useSession } from "../auth/session";
import {
  useInitialBootReadiness,
  useLoading,
  useLoadingActivity,
} from "../components/loading";
import { usePreparedNavigate } from "../hooks/usePreparedNavigate";
import { normalizeUserError } from "../lib/user-error-catalog";
import "./login.css";

const LOGIN_BACKGROUND_URL =
  "https://pub-56c14c350e6c453c98cb6275d38db861.r2.dev/Piramides_Maono.png";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/projects";
  }
  return value;
}

function isProjectsLandingPath(value: string) {
  return value === "/projects" || value.startsWith("/projects?");
}

function formField(form: HTMLFormElement, name: string) {
  return String(new FormData(form).get(name) ?? "");
}

const LoginPage: React.FC = () => {
  const session = useSession();
  const { initialBootActive, withLoading } = useLoading();
  const { prepareNavigate } = usePreparedNavigate();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const directLoginControllerRef = useRef<AbortController | null>(null);

  const next = safeNextPath(searchParams.get("next"));
  const projectsLanding = isProjectsLandingPath(next);
  const unauthenticatedReady = !session.loading && !session.authenticated;
  const authenticatedRedirectPending =
    !session.loading && session.authenticated;
  const bootCanCompleteOnLogin =
    unauthenticatedReady ||
    (authenticatedRedirectPending && !projectsLanding);

  useLoadingActivity(session.loading && !initialBootActive);
  useInitialBootReadiness(bootCanCompleteOnLogin);

  useEffect(
    () => () => {
      directLoginControllerRef.current?.abort();
      directLoginControllerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (
      session.loading ||
      !session.authenticated ||
      submitting ||
      redirecting
    ) {
      return;
    }

    setRedirecting(true);

    if (projectsLanding) {
      void prepareNavigate({
        route: "projects",
        to: next,
        replace: true,
        handoffKey: "login-projects",
      })
        .then((navigated) => {
          if (!navigated) setRedirecting(false);
        })
        .catch(() => {
          window.location.assign(next);
        });
      return;
    }

    navigate(next, { replace: true });
  }, [
    navigate,
    next,
    prepareNavigate,
    projectsLanding,
    redirecting,
    session.authenticated,
    session.loading,
    submitting,
  ]);

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

    directLoginControllerRef.current?.abort();
    const directController = new AbortController();
    directLoginControllerRef.current = directController;
    setSubmitting(true);

    try {
      if (projectsLanding) {
        const navigated = await prepareNavigate({
          route: "projects",
          to: next,
          replace: true,
          handoffKey: "login-projects",
          beforeNavigate: (signal) =>
            session.login(email, password, { signal }),
        });

        if (!navigated) setSubmitting(false);
        return;
      }

      await withLoading(() =>
        session.login(email, password, {
          signal: directController.signal,
        }),
      );

      if (!directController.signal.aborted) {
        navigate(next, { replace: true });
      }
    } catch (loginFailure) {
      if (!directController.signal.aborted) {
        setError(normalizeUserError(loginFailure).message);
        setSubmitting(false);
      }
    } finally {
      if (directLoginControllerRef.current === directController) {
        directLoginControllerRef.current = null;
      }
    }
  }

  const pageStyle = {
    "--maono-login-background": `url("${LOGIN_BACKGROUND_URL}")`,
    background: `#050505 url("${LoginPageBackground}") center / cover no-repeat`,
  } as CSSProperties;

  return (
    <main className="maono-login-page" style={pageStyle}>
      <section className="maono-login-page__card">
        <div className="maono-login-page__content maono-login-page__content--floating">
          <div className="maono-login-page__brand">
            <img src={Logo} alt="Maõno" className="maono-login-page__logo" />
            <h1>Faça seu login</h1>
            <p className="maono-login-page__intro">
              Entre para acessar seus projetos, mapas e permissões da plataforma.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="maono-login-page__form" autoComplete="on">
            <label className="maono-login-page__field" htmlFor="maono-login-email">
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

            <label className="maono-login-page__field" htmlFor="maono-login-password">
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

            {error ? (
              <div className="maono-login-page__error" role="alert">{error}</div>
            ) : null}

            <button
              className="maono-login-page__submit"
              type="submit"
              disabled={submitting || redirecting}
            >
              Entrar
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
