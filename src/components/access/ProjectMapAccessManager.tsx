import { useEffect, useMemo, useState } from "react";

import {
  loadProjectMapAccessPolicy,
  updateProjectCreateAccess,
  updateProjectMapRoute,
  type ProjectMapAccessPolicy,
  type ProjectMapRouteMode,
} from "./project-map-access-api";

type ApiId = number | string;

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a alteração.";
}

export default function ProjectMapAccessManager({
  organizationId,
  userId,
  onClose,
  onSaved,
}: {
  organizationId: ApiId;
  userId: ApiId;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}) {
  const [policy, setPolicy] = useState<ProjectMapAccessPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);

  const viewerRole = useMemo(
    () => String(policy?.target?.role || "").toLowerCase() === "viewer",
    [policy?.target?.role],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage(null);
    loadProjectMapAccessPolicy(organizationId, userId)
      .then((value) => {
        if (active) setPolicy(value);
      })
      .catch((error) => {
        if (active) setMessage({ kind: "error", text: errorText(error) });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organizationId, userId]);

  async function changeRoute(projectId: ApiId, mode: ProjectMapRouteMode) {
    const key = `project:${projectId}`;
    setSavingKey(key);
    setMessage(null);
    try {
      const next = await updateProjectMapRoute(
        organizationId,
        userId,
        projectId,
        mode,
      );
      setPolicy(next);
      await onSaved?.();
      setMessage({
        kind: "success",
        text:
          mode === "viewer"
            ? "Rota Viewer atribuída. A persistência direta deste projeto foi bloqueada."
            : "Rota Editor atribuída. A rota Viewer deixou de estar disponível para este projeto.",
      });
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setSavingKey(null);
    }
  }

  async function changeCreate(enabled: boolean) {
    setSavingKey("create");
    setMessage(null);
    try {
      const next = await updateProjectCreateAccess(
        organizationId,
        userId,
        enabled,
      );
      setPolicy(next);
      await onSaved?.();
      setMessage({
        kind: "success",
        text: enabled
          ? "Criação de novos projetos liberada."
          : "Criação de novos projetos negada explicitamente.",
      });
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div
      className="org-permission-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !savingKey) onClose();
      }}
    >
      <section
        className="org-permission-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-map-access-title"
      >
        <header>
          <div>
            <span>ROTAS DO MAPA</span>
            <h3 id="project-map-access-title">Acesso Viewer ou Editor</h3>
            <p>
              Cada pessoa recebe exatamente uma rota por projeto. A criação de
              novos projetos é uma permissão independente da rota do mapa.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        <div className="org-permission-body">
          {loading && <p role="status">Carregando acessos aos projetos...</p>}

          {!loading && policy && (
            <>
              <div className="org-permission-scope" role="status">
                <strong>
                  {policy.target.name || policy.target.email || "Pessoa"}
                </strong>
                <span>
                  {viewerRole
                    ? "Perfil Viewer: a rota Viewer é obrigatória e o Create permanece bloqueado."
                    : "Escolha Viewer ou Editor em cada projeto. As opções são mutuamente exclusivas."}
                </span>
              </div>

              <div className="org-permission-catalog">
                <fieldset>
                  <legend>Rota por projeto</legend>
                  {policy.projectRoutes.length === 0 && (
                    <p>Esta pessoa ainda não possui vínculo com projetos ativos.</p>
                  )}
                  {policy.projectRoutes.map((project) => {
                    const effectiveMode: ProjectMapRouteMode = viewerRole
                      ? "viewer"
                      : project.mode;
                    return (
                      <label
                        key={String(project.projectId)}
                        className="org-permission-option"
                      >
                        <span>
                          <strong>{project.projectName}</strong>
                          <small>/{project.projectSlug}</small>
                        </span>
                        <select
                          aria-label={`Rota do projeto ${project.projectName}`}
                          value={effectiveMode}
                          disabled={
                            viewerRole ||
                            savingKey === `project:${project.projectId}`
                          }
                          onChange={(event) =>
                            void changeRoute(
                              project.projectId,
                              event.target.value as ProjectMapRouteMode,
                            )
                          }
                        >
                          <option value="viewer">Viewer</option>
                          {!viewerRole && <option value="editor">Editor</option>}
                        </select>
                      </label>
                    );
                  })}
                </fieldset>

                <fieldset>
                  <legend>Criação de projetos</legend>
                  <label
                    className={
                      "org-permission-option" +
                      (viewerRole ? " disabled" : "")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={!viewerRole && Boolean(policy.create.allowed)}
                      disabled={viewerRole || savingKey === "create"}
                      onChange={(event) =>
                        void changeCreate(event.target.checked)
                      }
                    />
                    <span>
                      <strong>Pode criar novos projetos</strong>
                      <small>
                        Controla /maps/new/create e não altera a rota Viewer ou
                        Editor dos projetos existentes.
                      </small>
                    </span>
                  </label>
                </fieldset>
              </div>
            </>
          )}

          {message && (
            <div
              className={"org-permission-notice " + message.kind}
              role={message.kind === "error" ? "alert" : "status"}
            >
              {message.text}
            </div>
          )}
        </div>

        <footer>
          <button
            type="button"
            className="mm-btn"
            onClick={onClose}
            disabled={Boolean(savingKey)}
          >
            Fechar
          </button>
        </footer>
      </section>
    </div>
  );
}
