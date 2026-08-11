import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router";
import { useSession } from "../../../auth/session";
import {
  captureProjectThumbnail,
  serializeProjectConfig,
} from "../thumbnail/capture-thumbnail";
import { getMaonoConfigForSave } from "../clustering/point-cluster-store";
import {
  enqueueProjectThumbnailJob,
  type ProjectThumbnailJobState,
} from "../thumbnail/background-thumbnail-job";
import ProjectCreatePanel, {
  type ProjectCreateInput,
  type ProjectCreationStage,
} from "./project-create-panel";
import { useKeplerEngineAdapter } from "../engine-adapter";
import { useMapPanel } from "../map-panel/MapPanelContext";
import {
  emitMapSaveResult,
  MAONO_MAP_SAVE_REQUEST_EVENT,
  mapSaveRequestFromEvent,
  type MapSaveRequestDetail,
  type MapSaveResultStatus,
} from "../map-panel/map-save-events";
import { emitMapPanelTelemetry } from "../map-panel/map-panel-telemetry";

const CREATION_KEY_PREFIX = "maono.project-create.idempotency";
const ASYNC_THUMBNAIL_ENABLED =
  String(
    import.meta.env.VITE_ASYNC_PROJECT_THUMBNAIL ?? "true",
  ).toLowerCase() !== "false";

type ErrorCategory =
  | "AUTH"
  | "PERMISSION"
  | "PROJECT"
  | "MAP_CONFIG"
  | "STORAGE"
  | "PERFORMANCE"
  | "SPATIAL"
  | "ENGINE"
  | "INFRASTRUCTURE";

type ApiError = {
  code?: string;
  category?: ErrorCategory;
  retryable?: boolean;
  correlationId?: string;
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
        category: "INFRASTRUCTURE",
        retryable: true,
        correlationId: response.headers.get("X-Correlation-Id") || undefined,
      },
    };
  }
}

function getBackendErrorMessage(data: any) {
  const message = data?.error?.message || data?.message;
  return typeof message === "string" ? message.trim() : "";
}

function getErrorReference(data: any) {
  const code = typeof data?.error?.code === "string" ? data.error.code.trim() : "";
  const category = typeof data?.error?.category === "string" ? data.error.category.trim() : "";
  const correlationId =
    typeof data?.error?.correlationId === "string"
      ? data.error.correlationId.trim()
      : "";
  const parts = [category, code].filter(Boolean).join("/");
  if (!parts && !correlationId) return "";
  return ` (${parts || "ERRO"}${correlationId ? ` • ID ${correlationId}` : ""})`;
}

function getSaveErrorMessage(response: Response, data: any) {
  const reference = getErrorReference(data);
  const category = data?.error?.category as ErrorCategory | undefined;
  const retryable = data?.error?.retryable === true;

  if (response.status === 401) {
    return `Sua sessão expirou. Entre novamente para salvar o projeto.${reference}`;
  }

  if (response.status === 403) {
    return `Você não tem permissão para salvar alterações permanentes neste projeto.${reference}`;
  }

  if (response.status === 409) {
    return `O projeto foi alterado em outro lugar. Recarregue o mapa antes de salvar novamente.${reference}`;
  }

  if (response.status === 404) {
    return `Projeto não encontrado ou sem permissão de acesso.${reference}`;
  }

  if (response.status >= 500) {
    if (category === "STORAGE") {
      return `${retryable ? "O armazenamento está temporariamente indisponível. Tente novamente em alguns instantes." : "O armazenamento recusou o salvamento e requer verificação."}${reference}`;
    }
    if (category === "INFRASTRUCTURE") {
      return `${retryable ? "A infraestrutura está temporariamente indisponível. Tente novamente em alguns instantes." : "A infraestrutura não conseguiu concluir o salvamento."}${reference}`;
    }
    if (category === "MAP_CONFIG") {
      return `${getBackendErrorMessage(data) || "A configuração do mapa não pôde ser salva."}${reference}`;
    }
    return `${getBackendErrorMessage(data) || "Não foi possível salvar agora."}${reference}`;
  }

  return `${getBackendErrorMessage(data) || "Não foi possível salvar o projeto."}${reference}`;
}

function getSaveFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : "";

  if (!message) {
    return "Erro ao salvar projeto.";
  }

  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Não foi possível conectar à API para salvar o projeto. (INFRASTRUCTURE/INFRASTRUCTURE_NETWORK_FAILURE)";
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
  const reference = getErrorReference(data);

  if (response.status === 401) {
    return `Sua sessão expirou. Entre novamente para criar o projeto.${reference}`;
  }

  if (response.status === 403) {
    return `Você não tem permissão para criar projetos nesta organização.${reference}`;
  }

  if (response.status === 409) {
    return `${backendMessage || "A criação já está em andamento ou entrou em conflito. Tente novamente."}${reference}`;
  }

  if (response.status >= 500) {
    return `${backendMessage || "A criação não foi concluída. O projeto permaneceu inativo e pode ser retomado."}${reference}`;
  }

  return `${backendMessage || "Não foi possível criar o projeto."}${reference}`;
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
  const { authenticated, user } = useSession();
  const { context, refresh } = useMapPanel();
  const {
    commands,
    state: engineState,
  } = useKeplerEngineAdapter();
  const mapState = useSelector(
    (state: any) => state?.demo?.keplerGl?.map,
  );
  const operationInFlightRef = useRef(false);
  const primaryActionRef = useRef<
    (request?: MapSaveRequestDetail | null) => void
  >(() => {});
  const pendingSaveRequestRef =
    useRef<MapSaveRequestDetail | null>(null);
  const commandsRef = useRef(commands);
  const transientDatasetIdsRef = useRef(new Set<string>());
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

  commandsRef.current = commands;
  transientDatasetIdsRef.current = new Set(
    engineState.transientDatasetIds,
  );

  const activeOrganizationId = useMemo(
    () => getActiveOrganizationId(user as any),
    [user],
  );
  const activeOrganizationName = useMemo(
    () => getActiveOrganizationName(user as any),
    [user],
  );
  const canSaveExisting = useMemo(
    () => Boolean(
      authenticated &&
      projectSlug &&
      context?.capabilities?.saveMap
    ),
    [
      authenticated,
      context?.capabilities?.saveMap,
      projectSlug,
    ],
  );
  const canCreateNew = useMemo(
    () => Boolean(
      authenticated &&
      !projectSlug &&
      activeOrganizationId &&
      context?.capabilities?.saveMap
    ),
    [
      activeOrganizationId,
      authenticated,
      context?.capabilities?.saveMap,
      projectSlug,
    ],
  );
  const allowed = projectSlug ? canSaveExisting : canCreateNew;

  useEffect(() => {
    const handleExternalSaveRequest = (event: Event) => {
      const request = mapSaveRequestFromEvent(event);

      if (!request) {
        return;
      }

      if (
        operationInFlightRef.current ||
        pendingSaveRequestRef.current
      ) {
        emitMapSaveResult(
          request,
          "error",
          "Já existe um salvamento em andamento.",
        );
        return;
      }

      if (
        !transientDatasetIdsRef.current.has(request.dataId)
      ) {
        emitMapSaveResult(
          request,
          "error",
          "A prévia temporária não está mais disponível.",
        );
        return;
      }

      const promoted =
        commandsRef.current.markLayerPersistent(request.dataId);

      if (!promoted.ok) {
        emitMapSaveResult(request, "error", promoted.reason);
        return;
      }

      pendingSaveRequestRef.current = request;
      primaryActionRef.current(request);
    };

    window.addEventListener(
      MAONO_MAP_SAVE_REQUEST_EVENT,
      handleExternalSaveRequest,
    );

    return () => {
      window.removeEventListener(
        MAONO_MAP_SAVE_REQUEST_EVENT,
        handleExternalSaveRequest,
      );
    };
  }, []);

  function finishPendingMapSave(
    status: MapSaveResultStatus,
    failureMessage: string | null = null,
  ) {
    const request = pendingSaveRequestRef.current;

    if (!request) return;

    if (status !== "success") {
      commandsRef.current.markLayerTransient(request.dataId);
    }

    pendingSaveRequestRef.current = null;
    emitMapSaveResult(request, status, failureMessage);
  }

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
      const failure =
        "Você não tem permissão para salvar alterações permanentes neste projeto.";
      setMessageType("error");
      setMessage(failure);
      finishPendingMapSave("error", failure);
      return;
    }

    if (!projectSlug || !mapState) {
      const failure =
        "O mapa ainda não está pronto para ser salvo.";
      setMessageType("error");
      setMessage(failure);
      finishPendingMapSave("error", failure);
      return;
    }

    if (operationInFlightRef.current) {
      const failure = "Já existe um salvamento em andamento.";
      setMessageType("error");
      setMessage(failure);
      finishPendingMapSave("error", failure);
      return;
    }

    operationInFlightRef.current = true;
    setSaving(true);
    setMessage("");
    emitMapPanelTelemetry("map_save_requested", {
      mode: context?.mode ?? null,
      projectId: context?.project?.id ?? null,
      organizationId: context?.organization?.id ?? null,
      policyVersion: context?.policyVersion ?? null,
      operation: "update",
    });

    try {
      const config: any = serializeProjectConfig(mapState);
      const maonoConfig = getMaonoConfigForSave();
      if (maonoConfig) {
        config.maono = maonoConfig;
      }
      const legacy = await legacyCapture(config);
      const expectedConfigRevision = Math.max(
        0,
        Number(
          context?.version ??
            context?.project?.configRevision ??
            0,
        ) || 0,
      );
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
            expectedConfigRevision,
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
        if (response.status === 403) {
          refresh();
        }
        if (response.status === 409) {
          emitMapPanelTelemetry("map_save_conflict", {
            mode: context?.mode ?? null,
            projectId: context?.project?.id ?? null,
            organizationId: context?.organization?.id ?? null,
            code: data?.error?.code ?? "PROJECT_VERSION_CONFLICT",
            operation: "update",
          });
        }
        throw new Error(getSaveErrorMessage(response, data));
      }

      const revision = resolveConfigRevision(data);
      void refresh();
      emitMapPanelTelemetry("map_save_succeeded", {
        mode: context?.mode ?? null,
        projectId: context?.project?.id ?? null,
        organizationId: context?.organization?.id ?? null,
        policyVersion: context?.policyVersion ?? null,
        operation: "update",
      });
      setMessageType("success");
      setMessage(
        ASYNC_THUMBNAIL_ENABLED
          ? "Projeto salvo na Maõno. A visualização está sendo atualizada em segundo plano."
          : "Projeto e visualização salvos na Maõno.",
      );
      finishPendingMapSave("success");
      enqueuePreview(
        projectSlug,
        revision,
        config,
        handlePreviewState,
      );
    } catch (error) {
      const failure = getSaveFailureMessage(error);
      setMessageType("error");
      setMessage(failure);
      finishPendingMapSave("error", failure);
    } finally {
      operationInFlightRef.current = false;
      setSaving(false);
    }
  }

  async function handleCreateProject(input: ProjectCreateInput) {
    if (
      !canCreateNew ||
      !mapState ||
      !activeOrganizationId
    ) {
      const failure =
        "O novo projeto ainda não está pronto para ser criado.";
      setCreationStage("error");
      setCreationError(failure);
      finishPendingMapSave("error", failure);
      return;
    }

    if (operationInFlightRef.current) {
      const failure = "Já existe uma criação em andamento.";
      setCreationStage("error");
      setCreationError(failure);
      finishPendingMapSave("error", failure);
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
    emitMapPanelTelemetry("map_save_requested", {
      mode: context?.mode ?? null,
      organizationId: context?.organization?.id ?? activeOrganizationId,
      policyVersion: context?.policyVersion ?? null,
      operation: "create",
    });

    try {
      const config: any = serializeProjectConfig(mapState);
      const maonoConfig = getMaonoConfigForSave();
      if (maonoConfig) {
        config.maono = maonoConfig;
      }
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
        if (response.status === 403) {
          refresh();
        }
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
      emitMapPanelTelemetry("map_save_succeeded", {
        mode: context?.mode ?? null,
        organizationId: context?.organization?.id ?? activeOrganizationId,
        policyVersion: context?.policyVersion ?? null,
        operation: "create",
      });
      finishPendingMapSave("success");
      enqueuePreview(createdSlug, revision, config);
      navigate(
        `/projects/${encodeURIComponent(createdSlug)}/edit`,
        { replace: true },
      );
    } catch (error) {
      const failure = getSaveFailureMessage(error);
      setCreationStage("error");
      setCreationError(failure);
      finishPendingMapSave("error", failure);
    } finally {
      operationInFlightRef.current = false;
      setSaving(false);
    }
  }

  function handlePrimaryAction(
    request: MapSaveRequestDetail | null = null,
  ) {
    if (
      !request &&
      transientDatasetIdsRef.current.size > 0
    ) {
      setMessageType("error");
      setMessage(
        "Confirme ou descarte a prévia de isócrona antes de salvar o mapa.",
      );
      return;
    }

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

  primaryActionRef.current = handlePrimaryAction;

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
            role={messageType === "error" ? "alert" : "status"}
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
          onClick={() => handlePrimaryAction(null)}
          disabled={saving || !mapState}
          className="rounded-2xl border border-emerald-300/50 bg-emerald-600 px-5 py-4 text-sm font-extrabold text-white shadow-2xl transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          title={
            projectSlug
              ? "Salvar alterações do projeto na Maõno"
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
            finishPendingMapSave(
              "cancelled",
              "A criação do projeto foi cancelada antes do salvamento da isócrona.",
            );
          }
        }}
        onSubmit={handleCreateProject}
      />
    </>
  );
};

export default MaonoSaveButton;
