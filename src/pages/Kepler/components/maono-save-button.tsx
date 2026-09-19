import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router";
import { useSession } from "../../../auth/session";
import { UniversalLoader } from "../../../components/loading";
import {
  buildApiError,
  parseResponseJson,
} from "../../../lib/api-transport";
import { normalizeUserError } from "../../../lib/user-error-catalog";
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
  mapSaveSourceAnalysisKind,
  type MapSaveRequestDetail,
  type MapSaveResultStatus,
} from "../map-panel/map-save-events";
import { emitMapPanelTelemetry } from "../map-panel/map-panel-telemetry";
import {
  beginClientSaveAttempt,
  buildSaveRequestHeaders,
  clientSaveTotalDurationMs,
  isNetworkSaveFailure,
  readSaveResponseDiagnostics,
  serializeSaveRequest,
  type ClientSaveAttempt,
} from "../save-observability";
import {
  executeProjectCreateFlow,
  ProjectCreateFlowError,
} from "../project-create-flow";
import {
  clearProjectUpdateRecovery,
  executePreparedProjectUpdate,
  getProjectUpdateRecovery,
  isSaveRequestAbort,
  prepareProjectUpdateSnapshot,
  rememberProjectUpdateRecovery,
  runWithSaveStallNotice,
  type PreparedProjectUpdateSnapshot,
} from "../save-operation-resilience";

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
    provider?: string;
    providerStatus?: number;
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
  const parsed = await parseResponseJson(response);

  if (parsed.valid) {
    return parsed.data;
  }

  return {
    ok: false,
    error: {
      code: "INFRASTRUCTURE_UNEXPECTED_ERROR",
      category: "INFRASTRUCTURE",
      retryable: true,
    },
  };
}

function userErrorMessage(error: unknown) {
  const presentation = normalizeUserError(error);
  return presentation.supportReference
    ? `${presentation.message} Referência: ${presentation.supportReference}.`
    : presentation.message;
}

function getSaveFailureMessage(error: unknown) {
  return userErrorMessage(error);
}

function getResponseFailureMessage(response: Response, data: unknown) {
  return userErrorMessage(buildApiError(response, data));
}

function emitSaveTelemetry(
  event: string,
  details: Parameters<typeof emitMapPanelTelemetry>[1] = {},
) {
  try {
    emitMapPanelTelemetry(event, details);
  } catch {
    // Observabilidade é best-effort e nunca pode alterar o resultado do save.
  }
}

function emitClientSaveFailure(
  attempt: ClientSaveAttempt,
  error: unknown,
  details: Parameters<typeof emitMapPanelTelemetry>[1] = {},
) {
  const networkFailure = isNetworkSaveFailure(error);
  emitSaveTelemetry("map_save_failed", {
    saveId: attempt.saveId,
    correlationId: attempt.correlationId,
    operation: attempt.operation,
    stage: null,
    code: networkFailure
      ? "INFRASTRUCTURE_NETWORK_FAILURE"
      : "PROJECT_SAVE_CLIENT_FAILURE",
    category: "INFRASTRUCTURE",
    retryable: networkFailure,
    durationMs: clientSaveTotalDurationMs(attempt),
    ...details,
  });
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
  const phase = String(value || "");

  if (
    phase === "capturing" ||
    phase === "creating_record" ||
    phase === "preparing_files" ||
    phase === "linking_user" ||
    phase === "finalizing"
  ) {
    return phase as Exclude<
      ProjectCreationStage,
      "ready" | "success" | "error"
    >;
  }

  return "creating_record";
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
  const [saveStalled, setSaveStalled] = useState(false);
  const activeSaveControllerRef = useRef<AbortController | null>(null);
  const [pendingUpdateRecovery, setPendingUpdateRecovery] =
    useState<PreparedProjectUpdateSnapshot | null>(() =>
      projectSlug ? getProjectUpdateRecovery(projectSlug) : null,
    );
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] =
    useState<"success" | "warning" | "error">("success");
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
    setPendingUpdateRecovery(
      projectSlug ? getProjectUpdateRecovery(projectSlug) : null,
    );
  }, [projectSlug]);

  function cancelActiveSaveWait() {
    activeSaveControllerRef.current?.abort();
  }

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

      const analysisKind = mapSaveSourceAnalysisKind(request.source);
      const promoted = commandsRef.current.markLayerPersistent(
        request.dataId,
        analysisKind,
      );

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
      const analysisKind = mapSaveSourceAnalysisKind(request.source);
      const rolledBack = commandsRef.current.markLayerTransient(
        request.dataId,
        analysisKind,
      );
      if (!rolledBack.ok && !failureMessage) {
        failureMessage = rolledBack.reason;
      }
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

  async function executeExistingProjectSnapshot(
    snapshot: PreparedProjectUpdateSnapshot,
    recovery: boolean,
  ) {
    if (operationInFlightRef.current) {
      return;
    }

    const controller = new AbortController();
    activeSaveControllerRef.current = controller;
    operationInFlightRef.current = true;
    setSaving(true);
    setSaveStalled(false);
    setMessage("");

    if (recovery) {
      emitSaveTelemetry("map_save_recovery_requested", {
        mode: context?.mode ?? null,
        projectId: context?.project?.id ?? null,
        organizationId: context?.organization?.id ?? null,
        operation: "update",
        saveId: snapshot.attempt.saveId,
        correlationId: snapshot.attempt.correlationId,
        payloadBytes: snapshot.serialized.payloadBytes,
        serializeDurationMs: snapshot.serialized.serializeDurationMs,
        expectedRevision: snapshot.expectedConfigRevision,
      });
    }

    let failureTelemetryEmitted = false;

    try {
      const result = await executePreparedProjectUpdate({
        snapshot,
        signal: controller.signal,
        onStall: () => {
          setSaveStalled(true);
          emitSaveTelemetry("map_save_stalled", {
            mode: context?.mode ?? null,
            projectId: context?.project?.id ?? null,
            organizationId: context?.organization?.id ?? null,
            operation: "update",
            saveId: snapshot.attempt.saveId,
            correlationId: snapshot.attempt.correlationId,
            payloadBytes: snapshot.serialized.payloadBytes,
            serializeDurationMs: snapshot.serialized.serializeDurationMs,
            durationMs: clientSaveTotalDurationMs(snapshot.attempt),
            expectedRevision: snapshot.expectedConfigRevision,
          });
        },
      });

      const {
        response,
        data,
        diagnostics: responseDiagnostics,
      } = result;

      if (!response.ok || data?.ok === false) {
        failureTelemetryEmitted = true;
        emitSaveTelemetry("map_save_failed", {
          mode: context?.mode ?? null,
          projectId: context?.project?.id ?? null,
          organizationId: context?.organization?.id ?? null,
          operation: "update",
          saveId: responseDiagnostics.saveId,
          correlationId: responseDiagnostics.correlationId,
          payloadBytes: snapshot.serialized.payloadBytes,
          serializeDurationMs: snapshot.serialized.serializeDurationMs,
          durationMs: clientSaveTotalDurationMs(snapshot.attempt),
          expectedRevision: snapshot.expectedConfigRevision,
          stage: data?.error?.details?.stage ?? null,
          code: data?.error?.code ?? "PROJECT_SAVE_FAILED",
          category: data?.error?.category ?? null,
          retryable:
            typeof data?.error?.retryable === "boolean"
              ? data.error.retryable
              : data?.error?.details?.retryable ?? null,
          httpStatus: response.status,
          provider: data?.error?.details?.provider ?? null,
          providerStatus: data?.error?.details?.providerStatus ?? null,
          serverTiming: responseDiagnostics.serverTiming,
        });

        if (response.status === 403 || response.status === 409) {
          void refresh();
        }

        if (recovery && response.status === 409) {
          clearProjectUpdateRecovery(snapshot.projectSlug);
          setPendingUpdateRecovery(null);
        }

        throw buildApiError(response, data);
      }

      const revision = resolveConfigRevision(data);
      clearProjectUpdateRecovery(snapshot.projectSlug);
      setPendingUpdateRecovery(null);
      void refresh();

      emitSaveTelemetry(
        recovery ? "map_save_recovery_succeeded" : "map_save_succeeded",
        {
          mode: context?.mode ?? null,
          projectId: context?.project?.id ?? null,
          organizationId: context?.organization?.id ?? null,
          policyVersion: context?.policyVersion ?? null,
          operation: "update",
          saveId: responseDiagnostics.saveId,
          correlationId: responseDiagnostics.correlationId,
          payloadBytes: snapshot.serialized.payloadBytes,
          serializeDurationMs: snapshot.serialized.serializeDurationMs,
          durationMs: clientSaveTotalDurationMs(snapshot.attempt),
          expectedRevision: snapshot.expectedConfigRevision,
          candidateRevision: revision,
          httpStatus: response.status,
          serverTiming: responseDiagnostics.serverTiming,
        },
      );

      setMessageType("success");
      setMessage(
        recovery
          ? "Tentativa anterior reconciliada. O projeto está salvo."
          : ASYNC_THUMBNAIL_ENABLED
            ? "Projeto salvo na Maõno. A visualização está sendo atualizada em segundo plano."
            : "Projeto e visualização salvos na Maõno.",
      );
      finishPendingMapSave("success");
      enqueuePreview(
        snapshot.projectSlug,
        revision,
        snapshot.config,
        handlePreviewState,
      );
    } catch (error) {
      if (isSaveRequestAbort(error)) {
        rememberProjectUpdateRecovery(snapshot);
        setPendingUpdateRecovery(snapshot);
        setMessageType("warning");
        setMessage(
          "A espera foi cancelada. Antes de salvar novas alterações, conclua a tentativa anterior para confirmar o estado do projeto.",
        );
        emitSaveTelemetry(
          recovery ? "map_save_recovery_cancelled" : "map_save_cancelled",
          {
            mode: context?.mode ?? null,
            projectId: context?.project?.id ?? null,
            organizationId: context?.organization?.id ?? null,
            operation: "update",
            saveId: snapshot.attempt.saveId,
            correlationId: snapshot.attempt.correlationId,
            payloadBytes: snapshot.serialized.payloadBytes,
            serializeDurationMs: snapshot.serialized.serializeDurationMs,
            durationMs: clientSaveTotalDurationMs(snapshot.attempt),
            expectedRevision: snapshot.expectedConfigRevision,
          },
        );
        finishPendingMapSave(
          "cancelled",
          "A espera do salvamento foi cancelada; a tentativa anterior precisa ser reconciliada.",
        );
        return;
      }

      if (!failureTelemetryEmitted) {
        emitClientSaveFailure(snapshot.attempt, error, {
          mode: context?.mode ?? null,
          projectId: context?.project?.id ?? null,
          organizationId: context?.organization?.id ?? null,
          payloadBytes: snapshot.serialized.payloadBytes,
          serializeDurationMs: snapshot.serialized.serializeDurationMs,
        });
      }

      const failure = getSaveFailureMessage(error);
      setMessageType("error");
      setMessage(failure);
      finishPendingMapSave("error", failure);
    } finally {
      if (activeSaveControllerRef.current === controller) {
        activeSaveControllerRef.current = null;
      }
      operationInFlightRef.current = false;
      setSaveStalled(false);
      setSaving(false);
    }
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

    if (pendingUpdateRecovery) {
      await executeExistingProjectSnapshot(
        pendingUpdateRecovery,
        true,
      );
      return;
    }

    if (operationInFlightRef.current) {
      const failure = "Já existe um salvamento em andamento.";
      setMessageType("error");
      setMessage(failure);
      finishPendingMapSave("error", failure);
      return;
    }

    const attempt = beginClientSaveAttempt("update");
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
    const snapshot = prepareProjectUpdateSnapshot({
      attempt,
      projectSlug,
      config,
      expectedConfigRevision,
      legacy,
    });

    emitSaveTelemetry("map_save_requested", {
      mode: context?.mode ?? null,
      projectId: context?.project?.id ?? null,
      organizationId: context?.organization?.id ?? null,
      policyVersion: context?.policyVersion ?? null,
      operation: "update",
      saveId: attempt.saveId,
      correlationId: attempt.correlationId,
    });
    emitSaveTelemetry("map_save_serialized", {
      mode: context?.mode ?? null,
      projectId: context?.project?.id ?? null,
      organizationId: context?.organization?.id ?? null,
      operation: "update",
      saveId: attempt.saveId,
      correlationId: attempt.correlationId,
      payloadBytes: snapshot.serialized.payloadBytes,
      serializeDurationMs: snapshot.serialized.serializeDurationMs,
      expectedRevision: expectedConfigRevision,
    });

    await executeExistingProjectSnapshot(snapshot, false);
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

    const attempt = beginClientSaveAttempt("create");
    let failureTelemetryEmitted = false;
    let payloadBytes: number | null = null;
    let serializeDurationMs: number | null = null;
    let transport: "inline" | "stream" | null = null;

    setCreationDraft(input);
    const controller = new AbortController();
    activeSaveControllerRef.current = controller;
    operationInFlightRef.current = true;
    setSaving(true);
    setSaveStalled(false);
    setCreationError(null);
    setCreationFailedStage(null);
    setCreationStage(
      ASYNC_THUMBNAIL_ENABLED ? "creating_record" : "capturing",
    );
    emitSaveTelemetry("map_save_requested", {
      mode: context?.mode ?? null,
      organizationId: context?.organization?.id ?? activeOrganizationId,
      policyVersion: context?.policyVersion ?? null,
      operation: "create",
      saveId: attempt.saveId,
      correlationId: attempt.correlationId,
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

      const result = await runWithSaveStallNotice({
        onStall: () => {
          setSaveStalled(true);
          emitSaveTelemetry("map_save_stalled", {
            mode: context?.mode ?? null,
            organizationId:
              context?.organization?.id ?? activeOrganizationId,
            operation: "create",
            saveId: attempt.saveId,
            correlationId: attempt.correlationId,
            payloadBytes,
            serializeDurationMs,
            durationMs: clientSaveTotalDurationMs(attempt),
            transport,
          });
        },
        operation: () =>
          executeProjectCreateFlow({
        attempt,
        name: input.name,
        description: input.description,
        organizationId: activeOrganizationId,
        idempotencyKey,
        config,
        legacy,
        onPrepared(prepared) {
          payloadBytes = prepared.configPayloadBytes;
          serializeDurationMs = prepared.serializeDurationMs;
          transport = prepared.large ? "stream" : "inline";
          emitSaveTelemetry("map_save_serialized", {
            mode: context?.mode ?? null,
            organizationId:
              context?.organization?.id ?? activeOrganizationId,
            operation: "create",
            saveId: attempt.saveId,
            correlationId: attempt.correlationId,
            payloadBytes,
            serializeDurationMs,
            expectedRevision: 0,
            transport,
          });
        },
        onStage(stage) {
          setCreationStage(stage);
        },
        signal: controller.signal,
          }),
      });

      setCreationStage("success");
      clearCreationKey(activeOrganizationId);

      emitSaveTelemetry("map_save_succeeded", {
        mode: context?.mode ?? null,
        organizationId: context?.organization?.id ?? activeOrganizationId,
        policyVersion: context?.policyVersion ?? null,
        operation: "create",
        saveId: result.diagnostics.saveId,
        correlationId: result.diagnostics.correlationId,
        payloadBytes,
        serializeDurationMs,
        durationMs: clientSaveTotalDurationMs(attempt),
        expectedRevision: 0,
        candidateRevision: result.revision,
        httpStatus: result.response.status,
        serverTiming: result.diagnostics.serverTiming,
        transport: result.transport,
      });
      finishPendingMapSave("success");
      enqueuePreview(result.createdSlug, result.revision, config);
      navigate(
        `/projects/${encodeURIComponent(result.createdSlug)}/edit`,
        { replace: true },
      );
    } catch (error) {
      if (isSaveRequestAbort(error)) {
        emitSaveTelemetry("map_save_cancelled", {
          mode: context?.mode ?? null,
          organizationId:
            context?.organization?.id ?? activeOrganizationId,
          operation: "create",
          saveId: attempt.saveId,
          correlationId: attempt.correlationId,
          payloadBytes,
          serializeDurationMs,
          durationMs: clientSaveTotalDurationMs(attempt),
          transport,
        });
        setCreationFailedStage(normalizeCreationStage(creationStage));
        setCreationStage("error");
        setCreationError(
          "A espera foi cancelada. Tente novamente para retomar a criação com a mesma chave de segurança.",
        );
        finishPendingMapSave(
          "cancelled",
          "A espera da criação foi cancelada antes da confirmação final.",
        );
        return;
      }

      if (error instanceof ProjectCreateFlowError) {
        failureTelemetryEmitted = true;
        const data = error.data as ProjectWriteResponse;
        emitSaveTelemetry("map_save_failed", {
          mode: context?.mode ?? null,
          organizationId:
            context?.organization?.id ?? activeOrganizationId,
          operation: "create",
          saveId: error.diagnostics.saveId,
          correlationId: error.diagnostics.correlationId,
          payloadBytes:
            error.prepared.configPayloadBytes ?? payloadBytes,
          serializeDurationMs:
            error.prepared.serializeDurationMs ?? serializeDurationMs,
          durationMs: clientSaveTotalDurationMs(attempt),
          expectedRevision: 0,
          stage: data?.error?.details?.stage ?? error.stage,
          code: data?.error?.code ?? "PROJECT_CREATION_FAILED",
          category: data?.error?.category ?? null,
          retryable:
            typeof data?.error?.retryable === "boolean"
              ? data.error.retryable
              : data?.error?.details?.retryable ?? null,
          httpStatus: error.response.status,
          provider: data?.error?.details?.provider ?? null,
          providerStatus: data?.error?.details?.providerStatus ?? null,
          serverTiming: error.diagnostics.serverTiming,
          transport:
            error.prepared.large ? "stream" : "inline",
        });
        if (error.response.status === 403) {
          refresh();
        }
        setCreationFailedStage(
          normalizeCreationStage(error.stage),
        );
        const failure = getResponseFailureMessage(
          error.response,
          data,
        );
        setCreationStage("error");
        setCreationError(failure);
        finishPendingMapSave("error", failure);
        return;
      }

      if (!failureTelemetryEmitted) {
        emitClientSaveFailure(attempt, error, {
          mode: context?.mode ?? null,
          organizationId: context?.organization?.id ?? activeOrganizationId,
          payloadBytes,
          serializeDurationMs,
          transport,
        });
      }
      const failure = getSaveFailureMessage(error);
      setCreationStage("error");
      setCreationError(failure);
      finishPendingMapSave("error", failure);
    } finally {
      if (activeSaveControllerRef.current === controller) {
        activeSaveControllerRef.current = null;
      }
      operationInFlightRef.current = false;
      setSaveStalled(false);
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
        "Confirme ou descarte a prévia de análise antes de salvar o mapa.",
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

        {projectSlug && saving && saveStalled ? (
          <button
            type="button"
            onClick={cancelActiveSaveWait}
            className="rounded-2xl border border-amber-300/60 bg-amber-900/95 px-4 py-3 text-sm font-extrabold text-white shadow-xl transition hover:bg-amber-800"
          >
            Cancelar espera
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => handlePrimaryAction(null)}
          disabled={saving || (!pendingUpdateRecovery && !mapState)}
          aria-busy={saving}
          className="rounded-2xl border border-emerald-300/50 bg-emerald-600 px-5 py-4 text-sm font-extrabold text-white shadow-2xl transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          title={
            pendingUpdateRecovery
              ? "Concluir e confirmar a tentativa anterior"
              : projectSlug
                ? "Salvar alterações do projeto na Maõno"
                : "Transformar este mapa em um novo projeto Maõno"
          }
        >
          <span className="inline-flex items-center justify-center gap-2">
            {saving ? (
              <UniversalLoader
                size="inline"
                accessibleLabel={
                  pendingUpdateRecovery
                    ? "Reconciliando salvamento"
                    : "Salvando projeto"
                }
              />
            ) : null}
            <span>
              {pendingUpdateRecovery
                ? "Concluir tentativa anterior"
                : projectSlug
                  ? "Salvar na Maõno"
                  : "Salvar como projeto"}
            </span>
          </span>
        </button>
      </div>

      <ProjectCreatePanel
        open={createPanelOpen}
        organizationName={activeOrganizationName}
        initialName={creationDraft?.name}
        initialDescription={creationDraft?.description}
        busy={saving}
        stalled={saveStalled}
        phase={creationStage}
        failedStage={creationFailedStage}
        error={creationError}
        onCancelWait={cancelActiveSaveWait}
        onClose={() => {
          if (!saving) {
            setCreatePanelOpen(false);
            finishPendingMapSave(
              "cancelled",
              "A criação do projeto foi cancelada antes do salvamento da análise.",
            );
          }
        }}
        onSubmit={handleCreateProject}
      />
    </>
  );
};

export default MaonoSaveButton;
