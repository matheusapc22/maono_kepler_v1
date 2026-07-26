import React, { useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router";
import { useSession } from "../../../auth/session";
import { can } from "../../../access-control/can";
import { PERMISSION } from "../../../access-control/permissions";
import {
  captureProjectThumbnail,
  serializeProjectConfig,
} from "../thumbnail/capture-thumbnail";
import {
  enqueueProjectThumbnailJob,
  type ProjectThumbnailJobState,
} from "../thumbnail/background-thumbnail-job";
import ProjectCreatePanel, {
  type ProjectCreateInput,
  type ProjectCreationStage,
} from "./project-create-panel";

const CREATION_KEY_PREFIX = "maono.project-create.idempotency";
const ASYNC_THUMBNAIL_ENABLED =
  String(
    import.meta.env.VITE_ASYNC_PROJECT_THUMBNAIL ?? "true",
  ).toLowerCase() !== "false";

type ApiError = {
  code?: string;
  message?: string;
  details?: {
    stage?: string;
    retryable?: boolean;
    idempotencyKey?: string;
  } | null;
};

type ProjectWriteResponse = {
  ok?: boolean;
  idempotent?: boolean;
  configRevision?: number;
  thumbnail?: {
    status?: string;
    revision?: number;
    thumbnailRevision?: number | null;
  };
  project?: {
    slug?: string;
    name?: string;
    configRevision?: number;
  };
  error?: ApiError;
};

function normalize(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

async function readJsonResponse(response: Response): Promise<any> {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: {
        message: "A API retornou uma resposta inesperada.",
        code: "INVALID_JSON_RESPONSE",
      },
    };
  }
}

function getBackendErrorMessage(data: any) {
  const message = data?.error?.message || data?.message;
  return typeof message === "string" ? message.trim() : "";
}

function getSaveErrorMessage(response: Response, data: any) {
  if (response.status === 401) {
    return "Sua sessão expirou. Entre novamente para salvar o projeto.";
  }

  if (response.status === 403) {
    return "Você não tem permissão para salvar alterações permanentes neste projeto.";
  }

  if (response.status === 409) {
    return "O projeto foi alterado em outro lugar. Recarregue o mapa antes de salvar novamente.";
  }

  if (response.status === 404) {
    return "Projeto não encontrado ou sem permissão de acesso.";
  }

  if (response.status >= 500) {
    return "Não foi possível salvar agora. Tente novamente em alguns instantes.";
  }

  return getBackendErrorMessage(data) || "Não foi possível salvar o projeto.";
}

function getSaveFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : "";

  if (!message) {
    return "Erro ao salvar projeto.";
  }

  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Não foi possível conectar à API para salvar o projeto.";
  }

  return message;
}

function getActiveOrganizationId(user: any) {
  return (
    user?.activeOrganizationId ??
    user?.active_organization_id ??
    user?.organizationId ??
    user?.organization_id ??
    user?.organization?.id ??
    null
  );
}

function getActiveOrganizationName(user: any) {
  const activeId = getActiveOrganizationId(user);
  const organizations = Array.isArray(user?.organizations)
    ? user.organizations
    : [];
  const active = organizations.find(
    (organization: any) =>
      String(organization?.id ?? "") === String(activeId ?? ""),
  );

  return active?.name ?? user?.organization?.name ?? "Organização ativa";
}

function creationStorageKey(organizationId: unknown) {
  return `${CREATION_KEY_PREFIX}:${String(organizationId ?? "none")}`;
}

function randomCreationKey() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `project-create:${crypto.randomUUID()}`;
  }

  return `project-create:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

function getOrCreateCreationKey(organizationId: unknown) {
  const storageKey = creationStorageKey(organizationId);

  try {
    const existing = window.sessionStorage.getItem(storageKey);

    if (existing) {
      return existing;
    }

    const created = randomCreationKey();
    window.sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return randomCreationKey();
  }
}

function clearCreationKey(organizationId: unknown) {
  try {
    window.sessionStorage.removeItem(creationStorageKey(organizationId));
  } catch {
    // sessionStorage bloqueado não impede a criação.
  }
}

function normalizeCreationStage(value: unknown) {
  const stage = String(value || "");

  if (
    stage === "capturing" ||
    stage === "creating_record" ||
    stage === "preparing_files" ||
    stage === "linking_user" ||
    stage === "finalizing"
  ) {
    return stage as Exclude<
      ProjectCreationStage,
      "ready" | "success" | "error"
    >;
  }

  return "creating_record";
}

function getCreationResponseError(
  response: Response,
  data: ProjectWriteResponse,
) {
  const backendMessage = data?.error?.message;

  if (response.status === 401) {
    return "Sua sessão expirou. Entre novamente para criar o projeto.";
  }

  if (response.status === 403) {
    return "Você não tem permissão para criar projetos nesta organização.";
  }

  if (response.status === 409) {
    return (
      backendMessage ||
      "A criação já está em andamento ou entrou em conflito. Tente novamente."
    );
  }

  if (response.status >= 500) {
    return (
      backendMessage ||
      "A criação não foi concluída. O projeto permaneceu inativo e pode ser retomado."
    );
  }

  return backendMessage || "Não foi possível criar o projeto.";
}

function resolveConfigRevision(data: ProjectWriteResponse) {
  return Math.max(
    0,
    Number(
      data?.configRevision ??
        data?.thumbnail?.revision ??
        data?.project?.configRevision ??
        0,
    ) || 0,
  );
}

const MaonoSaveButton: React.FC = () => {
  const { projectSlug } = useParams();
  const navigate = useNavigate();
  const { authenticated, user, projects } = useSession();
  const mapState = useSelector(
    (state: any) => state?.demo?.keplerGl?.map,
  );
  const operationInFlightRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] =
    useState<"success" | "error">("success");
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [creationStage, setCreationStage] =
    useState<ProjectCreationStage>("ready");
  const [creationFailedStage, setCreationFailedStage] =
    useState<Exclude<
      ProjectCreationStage,
      "ready" | "success" | "error"
    > | null>(null);
  const [creationError, setCreationError] =
    useState<string | null>(null);
  const [creationDraft, setCreationDraft] =
    useState<ProjectCreateInput | null>(null);

  const currentProject = useMemo(
    () =>
      (projects || []).find(
        (project: any) =>
          normalize(project?.slug) === normalize(projectSlug),
      ) || null,
    [projects, projectSlug],
  );
  const activeOrganizationId = useMemo(
    () => getActiveOrganizationId(user as any),
    [user],
  );
  const activeOrganizationName = useMemo(
    () => getActiveOrganizationName(user as any),
    [user],
  );
  const savePermissionContext = useMemo(() => {
    if (!currentProject) {
      return null;
    }

    return {
      project: currentProject,
      projectId: currentProject.id ?? null,
      projectSlug: currentProject.slug ?? projectSlug ?? null,
      organizationId:
        currentProject.organizationId ??
        currentProject.organization_id ??
        activeOrganizationId ??
        null,
      permissions: currentProject.permissions ?? [],
    };
  }, [activeOrganizationId, currentProject, projectSlug]);
  const canSaveExisting = useMemo(
    () =>
      Boolean(
        authenticated &&
          projectSlug &&
          savePermissionContext &&
          can(
            user as any,
            PERMISSION.PROJECT_SAVE,
            savePermissionContext,
          ),
      ),
    [
      authenticated,
      projectSlug,
      savePermissionContext,
      user,
    ],
  );
  const canCreateNew = useMemo(
    () =>
      Boolean(
        authenticated &&
          !projectSlug &&
          activeOrganizationId &&
          can(user as any, PERMISSION.PROJECT_CREATE, {
            organizationId: activeOrganizationId,
          }),
      ),
    [
      activeOrganizationId,
      authenticated,
      projectSlug,
      user,
    ],
  );
  const allowed = projectSlug ? canSaveExisting : canCreateNew;

  function handlePreviewState(state: ProjectThumbnailJobState) {
    if (state === "READY") {
      setMessageType("success");
      setMessage("Projeto salvo. A visualização PNG já foi atualizada.");
    } else if (state === "FAILED") {
      setMessageType("error");
      setMessage(
        "Projeto salvo, mas a visualização PNG não pôde ser atualizada. O mapa continua disponível.",
      );
    }
  }

  function enqueuePreview(
    slug: string,
    revision: number,
    config: any,
    onState?: (state: ProjectThumbnailJobState) => void,
  ) {
    if (
      !ASYNC_THUMBNAIL_ENABLED ||
      !activeOrganizationId ||
      !revision
    ) {
      return;
    }

    void enqueueProjectThumbnailJob({
      slug,
      organizationId: activeOrganizationId,
      revision,
      mapState,
      savedConfig: config,
      onState,
    });
  }

  async function legacyCapture(config: any) {
    if (ASYNC_THUMBNAIL_ENABLED) {
      return null;
    }

    return captureProjectThumbnail(mapState, config);
  }

  async function handleExistingProjectSave() {
    if (!canSaveExisting) {
      setMessageType("error");
      setMessage(
        "Você não tem permissão para salvar alterações permanentes neste projeto.",
      );
      return;
    }

    if (!projectSlug || !mapState || operationInFlightRef.current) {
      return;
    }

    operationInFlightRef.current = true;
    setSaving(true);
    setMessage("");

    try {
      const config = serializeProjectConfig(mapState);
      const legacy = await legacyCapture(config);
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectSlug)}/config`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            config,
            ...(legacy
              ? {
                  thumbnailDataUrl: legacy.dataUrl,
                  thumbnailCapture: {
                    method: legacy.method,
                    diagnostics: legacy.diagnostics.join(" | "),
                  },
                }
              : {}),
          }),
        },
      );
      const data = await readJsonResponse(response);

      if (!response.ok || data?.ok === false) {
        throw new Error(getSaveErrorMessage(response, data));
      }

      const revision = resolveConfigRevision(data);
      setMessageType("success");
      setMessage(
        ASYNC_THUMBNAIL_ENABLED
          ? "Projeto salvo no Dropbox. A visualização está sendo atualizada em segundo plano."
          : "Projeto e visualização salvos no Dropbox.",
      );
      enqueuePreview(
        projectSlug,
        revision,
        config,
        handlePreviewState,
      );
    } catch (error) {
      setMessageType("error");
      setMessage(getSaveFailureMessage(error));
    } finally {
      operationInFlightRef.current = false;
      setSaving(false);
    }
  }

  async function handleCreateProject(input: ProjectCreateInput) {
    if (
      !canCreateNew ||
      !mapState ||
      !activeOrganizationId ||
      operationInFlightRef.current
    ) {
      return;
    }

    setCreationDraft(input);
    operationInFlightRef.current = true;
    setSaving(true);
    setCreationError(null);
    setCreationFailedStage(null);
    setCreationStage(
      ASYNC_THUMBNAIL_ENABLED ? "creating_record" : "capturing",
    );

    try {
      const config = serializeProjectConfig(mapState);
      const legacy = await legacyCapture(config);
      const idempotencyKey = getOrCreateCreationKey(
        activeOrganizationId,
      );

      setCreationStage("creating_record");
      const response = await fetch("/api/projects", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: input.name,
          description: input.description,
          organizationId: activeOrganizationId,
          idempotencyKey,
          config,
          ...(legacy
            ? {
                thumbnailDataUrl: legacy.dataUrl,
                thumbnailCapture: {
                  method: legacy.method,
                  diagnostics: legacy.diagnostics.join(" | "),
                },
              }
            : {}),
        }),
      });
      const data =
        (await readJsonResponse(response)) as ProjectWriteResponse;

      if (
        !response.ok ||
        data?.ok === false ||
        !data?.project?.slug
      ) {
        const failedStage = normalizeCreationStage(
          data?.error?.details?.stage,
        );
        setCreationFailedStage(failedStage);
        throw new Error(getCreationResponseError(response, data));
      }

      setCreationStage("success");
      clearCreationKey(activeOrganizationId);

      const createdSlug = data.project.slug;
      const revision = resolveConfigRevision(data);
      enqueuePreview(createdSlug, revision, config);
      navigate(
        `/projects/${encodeURIComponent(createdSlug)}/map`,
        { replace: true },
      );
    } catch (error) {
      setCreationStage("error");
      setCreationError(getSaveFailureMessage(error));
    } finally {
      operationInFlightRef.current = false;
      setSaving(false);
    }
  }

  function handlePrimaryAction() {
    if (projectSlug) {
      void handleExistingProjectSave();
      return;
    }

    setCreationError(null);
    setCreationFailedStage(null);

    if (creationStage !== "error") {
      setCreationStage("ready");
    }

    setCreatePanelOpen(true);
  }

  if (!allowed) {
    return null;
  }

  return (
    <>
      <div
        data-maono-no-preview="true"
        className="fixed bottom-6 right-6 z-[99998] flex flex-col items-end gap-3"
      >
        {message ? (
          <div
            role="status"
            aria-live="polite"
            className={
              messageType === "success"
                ? "max-w-xl rounded-2xl border border-emerald-300/50 bg-emerald-800/95 px-4 py-3 text-sm font-semibold text-white shadow-2xl"
                : "max-w-xl rounded-2xl border border-red-300/50 bg-red-900/95 px-4 py-3 text-sm font-semibold text-white shadow-2xl"
            }
          >
            {message}
          </div>
        ) : null}

        <button
          type="button"
          onClick={handlePrimaryAction}
          disabled={saving || !mapState}
          className="rounded-2xl border border-emerald-300/50 bg-emerald-600 px-5 py-4 text-sm font-extrabold text-white shadow-2xl transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          title={
            projectSlug
              ? "Salvar alterações no arquivo JSON original do projeto no Dropbox"
              : "Transformar este mapa em um novo projeto Maõno"
          }
        >
          {saving
            ? projectSlug
              ? "Salvando..."
              : "Criando..."
            : projectSlug
              ? "Salvar na Maõno"
              : "Salvar como projeto"}
        </button>
      </div>

      <ProjectCreatePanel
        open={createPanelOpen}
        organizationName={activeOrganizationName}
        initialName={creationDraft?.name}
        initialDescription={creationDraft?.description}
        busy={saving}
        stage={creationStage}
        failedStage={creationFailedStage}
        error={creationError}
        onClose={() => {
          if (!saving) {
            setCreatePanelOpen(false);
          }
        }}
        onSubmit={handleCreateProject}
      />
    </>
  );
};

export default MaonoSaveButton;
