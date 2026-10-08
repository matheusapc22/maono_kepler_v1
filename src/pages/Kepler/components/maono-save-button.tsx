import React, { useEffect, useRef, useState } from "react";
import { useSelector, useStore } from "react-redux";
import { useNavigate, useParams } from "react-router";
import { useSession } from "../../../auth/session";
import { buildApiError } from "../../../lib/api-transport";
import { normalizeUserError } from "../../../lib/user-error-catalog";
import { can } from "../../../access-control/can";
import { PERMISSION } from "../../../access-control/permissions";
import { UniversalLoader } from "../../../components/loading";
import { serializeProjectConfig } from "../thumbnail/capture-thumbnail";
import { getMaonoConfigForSave, subscribePointClusterStore } from "../clustering/point-cluster-store";
import { enqueueProjectThumbnailJob, prepareProjectThumbnailCapture, type PreparedPreviewCapture } from "../thumbnail/background-thumbnail-job";
import { isPreviewSessionCurrent } from "../thumbnail/preview-recovery";
import { ownsPreviewMessage, previewSnapshotWithoutPayload, type PreviewMessageOwner } from "../thumbnail/preview-message-owner";
import ProjectCreatePanel, { type ProjectCreateInput, type ProjectCreationStage } from "./project-create-panel";
import { useKeplerEngineAdapter } from "../engine-adapter";
import { useMapPanel } from "../map-panel/MapPanelContext";
import { emitMapSaveResult, MAONO_MAP_SAVE_REQUEST_EVENT, mapSaveRequestFromEvent, mapSaveSourceAnalysisKind, type MapSaveRequestDetail, type MapSaveResultStatus } from "../map-panel/map-save-events";
import { emitMapPanelTelemetry } from "../map-panel/map-panel-telemetry";
import { beginClientSaveAttempt, clientSaveTotalDurationMs } from "../save-observability";
import { createSaveEditGeneration } from "../save-edit-generation";
import { executeProjectCreateFlow } from "../project-create-flow";
import { canAdvanceOwnSaveBase, confirmationMatchesEditor, defaultDurableSaveStore, DurableSaveError, executePreparedProjectUpdate, isSaveRequestAbort, prepareProjectUpdateSnapshot, receiptRevision, type ProjectUpdateFlowResult } from "../durable-save-controller";
import { saveAccountKey, isPendingSaveSnapshot, snapshotMatchesProject, type DurableSaveSnapshot } from "../durable-save-store";

const ASYNC_THUMBNAIL_ENABLED = String(import.meta.env.VITE_ASYNC_PROJECT_THUMBNAIL ?? "true").toLowerCase() !== "false" && String(import.meta.env.VITE_PROJECT_PREVIEW_OPERATIONS_V1 ?? "false").toLowerCase() === "true";
function activeOrganizationId(user: any) { return user?.activeOrganizationId ?? user?.active_organization_id ?? user?.organizationId ?? user?.organization_id ?? user?.organization?.id ?? null; }
function emitSaveTelemetry(event: string, details: Parameters<typeof emitMapPanelTelemetry>[1] = {}) {
  try { emitMapPanelTelemetry(event, details); } catch { /* Telemetry never changes a committed result. */ }
}
function getSaveFailureMessage(error: unknown) {
  // Keep central classification, but no provider text, IDs or recovery instructions in public copy.
  const presentation = normalizeUserError(error instanceof DurableSaveError && !error.code ? buildApiError(error.response, error.data) : error);
  if (error instanceof DurableSaveError && (error.code === "SAVE_OPERATION_CONFLICT" || (error.data?.operation?.state ?? error.data?.state) === "CONFLICT" || (error.response.status === 409 && /REVISION|VERSION_CONFLICT|PROJECT_IDENTITY_CHANGED/.test(String(error.data?.error?.code ?? ""))))) {
    return "Não foi possível salvar porque o projeto foi alterado. Procure o suporte.";
  }
  if (error instanceof DurableSaveError && (["SAVE_OPERATION_FAILED_FINAL", "LOCAL_SAVE_PAYLOAD_EXPIRED", "LOCAL_SAVE_PAYLOAD_INTEGRITY_FAILED"].includes(String(error.code)) || ["FAILED_FINAL"].includes(String(error.data?.operation?.state)) || [400, 410, 413, 415, 422].includes(error.response.status))) return "Não foi possível salvar. Procure o suporte para continuar.";
  if (presentation.action === "login") return "Não foi possível salvar. Entre novamente para tentar de novo.";
  return "Não foi possível concluir o salvamento. Tente novamente. Se o problema continuar, procure o suporte.";
}
const MaonoSaveButton: React.FC = () => {
  const { projectSlug } = useParams();
  const navigate = useNavigate();
  const { authenticated, user, activeOrganization } = useSession();
  const { context } = useMapPanel();
  const { commands, state: engineState } = useKeplerEngineAdapter();
  const reduxStore = useStore<any>();
  const mapState = useSelector((state: any) => state?.demo?.keplerGl?.map);
  const organizationId = String(activeOrganization?.id ?? activeOrganizationId(user) ?? context?.organization?.id ?? "");
  const actorId = String(user?.id ?? "");
  const accountKey = authenticated && actorId && organizationId ? saveAccountKey(actorId, organizationId) : "";
  const projectId = String(context?.project?.id ?? "");
  const routeKey = `${accountKey}:${projectSlug ?? "new"}:${projectId}`;
  const contextRef = useRef(routeKey); contextRef.current = routeKey;
  const editorSessionId = useRef(beginClientSaveAttempt("update").saveId);
  const editGeneration = useRef(0);
  const expectedRevisionRef = useRef<{ route: string; revision: number } | null>(null);
  if (context?.capabilities?.saveMap && expectedRevisionRef.current?.route !== routeKey) expectedRevisionRef.current = { route: routeKey, revision: Number(context?.version ?? context?.project?.configRevision ?? 0) };
  const operationInFlightRef = useRef(false);
  const previewCaptures = useRef(new Map<string, PreparedPreviewCapture>());
  const previewMessageOwnerRef = useRef<PreviewMessageOwner | null>(null);
  function releasePreparedPreview(operationId: string) {
    previewCaptures.current.get(operationId)?.cancel();
    previewCaptures.current.delete(operationId);
  }
  useEffect(() => () => {
    for (const capture of previewCaptures.current.values()) capture.cancel();
    previewCaptures.current.clear();
    previewMessageOwnerRef.current = null;
  }, [routeKey]);
  const controllerRef = useRef<AbortController | null>(null);
  const primaryActionRef = useRef<(request?: MapSaveRequestDetail | null) => void>(() => {});
  const resumeRef = useRef<(snapshot: DurableSaveSnapshot) => Promise<void>>(async () => {});
  const pendingSaveRequestRef = useRef<MapSaveRequestDetail | null>(null);
  const commandsRef = useRef(commands); commandsRef.current = commands;
  const transientIdsRef = useRef(engineState.transientDatasetIds); transientIdsRef.current = engineState.transientDatasetIds;
  const [pending, setPending] = useState<DurableSaveSnapshot | null>(null);
  const pendingSnapshotRef = useRef<DurableSaveSnapshot | null>(null);
  pendingSnapshotRef.current = pending;
  const terminalFailure = Boolean(pending && ["conflict", "failed", "expired"].includes(pending.localState));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewState, setPreviewState] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "warning" | "error">("success");
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [creationStage, setCreationStage] = useState<ProjectCreationStage>("ready");
  function markCreationFailure() {
    setCreationStage("error");
  }
  const [creationError, setCreationError] = useState<string | null>(null);
  const [creationDraft, setCreationDraft] = useState<ProjectCreateInput | null>(null);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const allowed = Boolean(authenticated && actorId && organizationId && context?.capabilities?.saveMap && String(context?.organization?.id ?? "") === organizationId && (!projectSlug || Boolean(projectId)));

  const supportContext = { organizationId, organization: { id: organizationId } };
  const canOpenSupport = can(user, PERMISSION.TICKET_VIEW, supportContext) && can(user, PERMISSION.TICKET_CREATE, supportContext);
  function openSupport() {
    // Existing organization-scoped Central flow; a separate tab keeps the live editor intact.
    window.open(`/projects?cc_org=${encodeURIComponent(organizationId)}`, "_blank", "noopener,noreferrer");
  }

  // Observe edits synchronously, before React rendering. Only a Save click serializes/persists a snapshot.
  useEffect(() => {
    const observer = createSaveEditGeneration(reduxStore.getState()?.demo?.keplerGl?.map);
    const baseGeneration = editGeneration.current;
    const unsubscribe = reduxStore.subscribe(() => {
      const next = baseGeneration + observer.observe(reduxStore.getState()?.demo?.keplerGl?.map);
      if (next !== editGeneration.current) { setSaved(false); setPreviewState(""); setMessage(current => current === "Projeto salvo." ? "" : current); }
      editGeneration.current = next;
    });
    const unsubscribeClustering = subscribePointClusterStore(() => {
      editGeneration.current = baseGeneration + observer.observeExtensionChange();
      setSaved(false); setPreviewState(""); setMessage(current => current === "Projeto salvo." ? "" : current);
    });
    return () => { unsubscribe(); unsubscribeClustering(); };
  }, [reduxStore]);

  useEffect(() => {
    const controller = new AbortController();
    const scopeAtStart = routeKey;
    setPending(null); setMessage(""); setMessageType("success"); setCreatedSlug(null); setSaving(false); setSaved(false); setPreviewState("");
    setCreatePanelOpen(false); setCreationError(null); setCreationDraft(null); setCreationStage("ready");
    pendingSaveRequestRef.current = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const current = () => !controller.signal.aborted && contextRef.current === scopeAtStart;
    async function recover() {
      if (!accountKey || !allowed || !current()) return;
      if (operationInFlightRef.current) { retryTimer = setTimeout(() => { void recover(); }, 250); return; }
      try {
        const records = await defaultDurableSaveStore.listAccount(actorId, organizationId);
        if (!current()) return;
        const snapshot = records.find(value => value.manifest.operation !== "change_request" && isPendingSaveSnapshot(value) && (projectSlug ? snapshotMatchesProject(value, actorId, organizationId, projectSlug, projectId) : value.attempt.operation === "create"));
        setPending(snapshot ?? null);
        if (snapshot && !["conflict", "failed"].includes(snapshot.localState)) await resumeRef.current(snapshot);
        else if (snapshot) {
          setMessageType("error"); setMessage(snapshot.localState === "conflict" ? "Não foi possível salvar porque o projeto foi alterado. Procure o suporte." : "Não foi possível salvar. Procure o suporte para continuar.");
        }
      } catch (error) {
        if (current()) { setMessageType("warning"); setMessage(getSaveFailureMessage(error)); }
      }
    }
    void recover();
    window.addEventListener("online", recover);
    const channel = typeof BroadcastChannel !== "undefined" && accountKey ? new BroadcastChannel(`maono-save:${accountKey}`) : null;
    if (channel) channel.onmessage = () => { void recover(); };
    return () => {
      controller.abort(); controllerRef.current?.abort(); clearTimeout(retryTimer);
      window.removeEventListener("online", recover); channel?.close();
    };
  }, [routeKey, accountKey, actorId, organizationId, projectSlug, projectId, allowed]);

  useEffect(() => {
    function handle(event: Event) {
      const request = mapSaveRequestFromEvent(event);
      if (!request) return;
      if (operationInFlightRef.current || pendingSaveRequestRef.current || pendingSnapshotRef.current) { emitMapSaveResult(request, "error", "Já existe um salvamento em andamento."); return; }
      if (!transientIdsRef.current.includes(request.dataId)) { emitMapSaveResult(request, "error", "A prévia temporária não está mais disponível."); return; }
      const result = commandsRef.current.markLayerPersistent(request.dataId, mapSaveSourceAnalysisKind(request.source));
      if (!result.ok) { emitMapSaveResult(request, "error", result.reason); return; }
      pendingSaveRequestRef.current = request; primaryActionRef.current(request);
    }
    window.addEventListener(MAONO_MAP_SAVE_REQUEST_EVENT, handle);
    return () => window.removeEventListener(MAONO_MAP_SAVE_REQUEST_EVENT, handle);
  }, []);

  function finishPendingMapSave(status: MapSaveResultStatus, failureMessage: string | null = null, snapshotMatchesCurrent = false) {
    const request = pendingSaveRequestRef.current; if (!request) return;
    // Ambiguous/accepted operations must not roll a layer back while their persisted snapshot may publish.
    if (status !== "success" && !pending) commandsRef.current.markLayerTransient(request.dataId, mapSaveSourceAnalysisKind(request.source));
    pendingSaveRequestRef.current = null; emitMapSaveResult(request, status, failureMessage, snapshotMatchesCurrent);
  }
  function captureClickedConfig() {
    const current = reduxStore.getState()?.demo?.keplerGl?.map;
    if (!current) throw new Error("O mapa ainda não está pronto para ser salvo.");
    const config: any = serializeProjectConfig(current);
    const maono = getMaonoConfigForSave(); if (maono) config.maono = maono;
    return { config, generation: editGeneration.current, mapState: current };
  }
  function prepareClickedPreview(clicked: ReturnType<typeof captureClickedConfig>, saveOperationId: string, route: string) {
    if (!ASYNC_THUMBNAIL_ENABLED) return;
    const roots = document.querySelectorAll<HTMLElement>(".maono-kepler-viewport");
    const root = roots.length === 1 ? roots[0] : null;
    previewCaptures.current.set(saveOperationId, prepareProjectThumbnailCapture({
      actorId, organizationId, saveOperationId, root, editorSessionId: editorSessionId.current, editGeneration: clicked.generation,
      mapState: clicked.mapState, savedConfig: clicked.config,
      isCurrent: () => contextRef.current === route && editGeneration.current === clicked.generation,
    }));
  }
  function phaseChanged() {
    setMessageType("warning"); setMessage(""); setSaved(false);
  }
  async function accepted(result: ProjectUpdateFlowResult, recovery: boolean, route: string) {
    if (contextRef.current !== route) return;
    const snapshot = result.snapshot;
    const revision = receiptRevision(result.data);
    const currentRevision = Number(result.data?.operation?.currentRevision ?? result.data?.currentRevision ?? revision);
    const matches = confirmationMatchesEditor(snapshot, editorSessionId.current, editGeneration.current) && currentRevision === revision;
    if (expectedRevisionRef.current?.route === route && canAdvanceOwnSaveBase(snapshot, editorSessionId.current, expectedRevisionRef.current.revision, result.data)) expectedRevisionRef.current = { route, revision };
    const previewMessageOwner = { route, operationId: snapshot.manifest.operationId, revision };
    previewMessageOwnerRef.current = previewMessageOwner;
    setPending(null);
    emitSaveTelemetry(recovery ? "map_save_recovery_succeeded" : "map_save_succeeded", { operation: snapshot.attempt.operation, saveId: snapshot.attempt.saveId, correlationId: result.diagnostics.correlationId, expectedRevision: snapshot.expectedConfigRevision, candidateRevision: revision, snapshotMatchesCurrent: matches, payloadBytes: snapshot.manifest.payloadBytes, serializeDurationMs: snapshot.serialized.serializeDurationMs, httpStatus: result.response.status, serverTiming: result.diagnostics.serverTiming, durationMs: clientSaveTotalDurationMs(snapshot.attempt) });
    setSaved(matches);
    setMessageType(matches ? "success" : "warning");
    setMessage(matches ? "Projeto salvo." : "O salvamento foi concluído. Há alterações ainda não salvas.");
    if (result.data?.localCleanupWarning) emitSaveTelemetry("map_save_local_cleanup_pending", { operation: snapshot.attempt.operation, saveId: snapshot.attempt.saveId });
    finishPendingMapSave("success", null, matches);
    if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel(`maono-save:${accountKey}`); channel.postMessage({ operationId: snapshot.manifest.operationId }); channel.close(); }
    // The frame was frozen at the click. JSON confirmation never waits for PNG encoding/upload.
    const capture = previewCaptures.current.get(snapshot.manifest.operationId);
    previewCaptures.current.delete(snapshot.manifest.operationId);
    if (!ASYNC_THUMBNAIL_ENABLED || currentRevision !== revision) capture?.cancel();
    if (ASYNC_THUMBNAIL_ENABLED && currentRevision === revision) {
      const previewSnapshot = previewSnapshotWithoutPayload(snapshot);
      void enqueueProjectThumbnailJob({ snapshot: previewSnapshot, data: { receipt: result.data?.operation?.receipt ?? result.data?.receipt }, capture,
        isCurrent: () => isPreviewSessionCurrent(previewSnapshot.scope.actorId, previewSnapshot.scope.organizationId),
        onState: (state, detail) => {
          if (contextRef.current !== route || !ownsPreviewMessage(previewMessageOwnerRef.current, previewMessageOwner) ||
            !confirmationMatchesEditor(previewSnapshot, editorSessionId.current, editGeneration.current)) return;
          setPreviewState(state);
          if (detail?.errorCode) emitSaveTelemetry("map_save_preview_pending", { code: detail.errorCode });
        },
      }).catch(() => { /* PNG recovery is independent of JSON success. */ });
    }
  }
  async function runSnapshot(snapshot: DurableSaveSnapshot, recovery = true) {
    if (operationInFlightRef.current || !allowed) return;
    if (snapshot.scope.actorId !== actorId || snapshot.scope.organizationId !== organizationId || (projectSlug && !snapshotMatchesProject(snapshot, actorId, organizationId, projectSlug, projectId))) return;
    const route = routeKey;
    previewMessageOwnerRef.current = null;
    const controller = new AbortController(); controllerRef.current = controller;
    operationInFlightRef.current = true; setSaving(true); setSaved(false); setPreviewState(""); setCreationError(null); setPending(snapshot);
    const current = () => contextRef.current === route;
    if (recovery) emitSaveTelemetry("map_save_recovery_requested", { operation: snapshot.attempt.operation, saveId: snapshot.attempt.saveId, expectedRevision: snapshot.expectedConfigRevision });
    const onStall = () => { if (current()) { emitSaveTelemetry("map_save_stalled", { saveId: snapshot.attempt.saveId, operation: snapshot.attempt.operation, payloadBytes: snapshot.manifest.payloadBytes }); } };
    try {
      const common = { snapshot, signal: controller.signal, isScopeCurrent: current, onPhase: () => { if (current()) phaseChanged(); } };
      let result: ProjectUpdateFlowResult;
      if (snapshot.attempt.operation === "create") {
        const created = await executeProjectCreateFlow({ ...common, attempt: snapshot.attempt, actorId, organizationId, idempotencyKey: snapshot.creation!.idempotencyKey, name: "", description: "", config: null, editorSessionId: editorSessionId.current, editGeneration: editGeneration.current, onStage: stage => { if (current()) setCreationStage(stage); }, onStall });
        result = created;
        if (current()) { setCreationStage("success"); setCreatePanelOpen(false); setCreatedSlug(created.createdSlug); }
      } else {
        result = await executePreparedProjectUpdate({ ...common, scope: { ...snapshot.scope, actorId, organizationId, projectId }, onStall });
      }
      await accepted(result, recovery, route);
      if (snapshot.attempt.operation === "create" && current() && confirmationMatchesEditor(snapshot, editorSessionId.current, editGeneration.current)) navigate(`/projects/${encodeURIComponent(snapshot.projectSlug || result.snapshot.projectSlug)}/edit`, { replace: true });
    } catch (error) {
      if (!current()) return;
      const conflict = error instanceof DurableSaveError && ((error.data?.operation?.state ?? error.data?.state) === "CONFLICT" || error.response.status === 409);
      const stored = await defaultDurableSaveStore.get(snapshot.key).catch(() => null);
      if (!current()) return;
      if (stored && ["conflict", "failed", "expired"].includes(stored.localState)) releasePreparedPreview(snapshot.manifest.operationId);
      setPending(stored ?? snapshot); setMessageType("error");
      const failure = stored && ["failed", "expired"].includes(stored.localState) ? "Não foi possível salvar. Procure o suporte para continuar." : getSaveFailureMessage(error);
      setMessage(failure); setCreationError(failure);
      if (snapshot.attempt.operation === "create") markCreationFailure();
      emitSaveTelemetry(isSaveRequestAbort(error) ? "map_save_cancelled" : conflict ? "map_save_conflict" : "map_save_failed", { operation: snapshot.attempt.operation, saveId: snapshot.attempt.saveId, expectedRevision: snapshot.expectedConfigRevision, retryable: !conflict,
        code: error instanceof DurableSaveError ? error.data?.error?.code ?? error.data?.operation?.errorCode : "INFRASTRUCTURE_NETWORK_FAILURE",
        httpStatus: error instanceof DurableSaveError ? error.response.status : null,
      });
      // Do not revert an analysis layer whose accepted operation may still publish.
      const request = pendingSaveRequestRef.current; pendingSaveRequestRef.current = null;
      if (request) emitMapSaveResult(request, isSaveRequestAbort(error) ? "cancelled" : "error", failure, false);
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      operationInFlightRef.current = false;
      if (current()) { setSaving(false); }
    }
  }
  resumeRef.current = snapshot => runSnapshot(snapshot, true);

  async function handleExistingProjectSave() {
    if (!allowed || !projectSlug) return;
    if (pending) { await runSnapshot(pending); return; }
    if (operationInFlightRef.current) return;
    const route = routeKey;
    let clickedOperationId: string | null = null;
    previewMessageOwnerRef.current = null;
    let snapshotPersisted = false;
    operationInFlightRef.current = true; setSaving(true); setSaved(false); setPreviewState(""); setMessage("");
    try {
      const clicked = captureClickedConfig();
      const attempt = beginClientSaveAttempt("update");
      clickedOperationId = attempt.saveId;
      prepareClickedPreview(clicked, attempt.saveId, route);
      emitSaveTelemetry("map_save_requested", { operation: "update", saveId: attempt.saveId, correlationId: attempt.correlationId });
      const snapshot = await prepareProjectUpdateSnapshot({ attempt, scope: { actorId, organizationId, projectKey: `project:${projectId}`, projectId }, projectSlug, config: clicked.config, expectedConfigRevision: expectedRevisionRef.current!.revision, editorSessionId: editorSessionId.current, editGeneration: clicked.generation });
      if (contextRef.current !== route) return;
      await defaultDurableSaveStore.put(snapshot); snapshotPersisted = true;
      emitSaveTelemetry("map_save_serialized", { operation: "update", saveId: attempt.saveId, payloadBytes: snapshot.manifest.payloadBytes, serializeDurationMs: snapshot.serialized.serializeDurationMs, expectedRevision: snapshot.expectedConfigRevision });
      operationInFlightRef.current = false; await runSnapshot(snapshot, false);
    } catch (error) {
      if (clickedOperationId && !snapshotPersisted) releasePreparedPreview(clickedOperationId);
      if (contextRef.current === route) { setMessageType("error"); setMessage(getSaveFailureMessage(error)); finishPendingMapSave("error", getSaveFailureMessage(error)); }
    } finally { operationInFlightRef.current = false; if (contextRef.current === route) setSaving(false); }
  }
  async function handleCreateProject(input: ProjectCreateInput) {
    if (!allowed || operationInFlightRef.current) return;
    if (pending) { await runSnapshot(pending); return; }
    const route = routeKey;
    let clickedOperationId: string | null = null;
    previewMessageOwnerRef.current = null;
    operationInFlightRef.current = true; setSaving(true); setCreationDraft(input); setCreationError(null); setSaved(false); setPreviewState(""); setMessage(""); setCreationStage("creating_record");
    try {
      const clicked = captureClickedConfig();
      const attempt = beginClientSaveAttempt("create");
      clickedOperationId = attempt.saveId;
      prepareClickedPreview(clicked, attempt.saveId, route);
      emitSaveTelemetry("map_save_requested", { operation: "create", saveId: attempt.saveId, correlationId: attempt.correlationId });
      const result = await executeProjectCreateFlow({ attempt, name: input.name, description: input.description, actorId, organizationId, idempotencyKey: `project-create:${attempt.saveId}`, config: clicked.config, editorSessionId: editorSessionId.current, editGeneration: clicked.generation, isScopeCurrent: () => contextRef.current === route,
        signal: (controllerRef.current = new AbortController()).signal,
        onStage: stage => { if (contextRef.current === route) setCreationStage(stage); }, onPhase: () => { if (contextRef.current === route) phaseChanged(); }, onStall: () => { if (contextRef.current === route) emitSaveTelemetry("map_save_stalled", { saveId: attempt.saveId, operation: "create" }); },
        onPrepared: prepared => emitSaveTelemetry("map_save_serialized", { operation: "create", saveId: attempt.saveId, payloadBytes: prepared.configPayloadBytes, serializeDurationMs: prepared.serializeDurationMs, transport: prepared.large ? "stream" : "inline" }),
      });
      if (contextRef.current !== route) return;
      setCreationStage("success"); setCreatePanelOpen(false); setCreatedSlug(result.createdSlug);
      await accepted(result, false, route);
      if (confirmationMatchesEditor(result.snapshot, editorSessionId.current, editGeneration.current)) navigate(`/projects/${encodeURIComponent(result.createdSlug)}/edit`, { replace: true });
    } catch (error) {
      if (contextRef.current !== route) return;
      const records = await defaultDurableSaveStore.listAccount(actorId, organizationId).catch(() => []);
      if (contextRef.current !== route) return;
      const retained = records.find(value => value.manifest.operation === "create" && isPendingSaveSnapshot(value));
      setPending(retained ?? null);
      if (clickedOperationId && retained?.manifest.operationId !== clickedOperationId) releasePreparedPreview(clickedOperationId);
      const failure = retained && ["conflict", "failed", "expired"].includes(retained.localState) ? "Não foi possível salvar. Procure o suporte para continuar." : getSaveFailureMessage(error);
      markCreationFailure(); setCreationError(failure); setMessageType("error"); setMessage(failure);
      emitSaveTelemetry("map_save_failed", { operation: "create", retryable: true });
    } finally { operationInFlightRef.current = false; controllerRef.current = null; if (contextRef.current === route) { setSaving(false); } }
  }
  function handlePrimaryAction(request: MapSaveRequestDetail | null = null) {
    if (pending) { void runSnapshot(pending); return; }
    if (!request && transientIdsRef.current.length > 0) { setMessageType("error"); setMessage("Confirme ou descarte a prévia de análise antes de salvar o mapa."); return; }
    if (projectSlug) { void handleExistingProjectSave(); return; }
    if (createdSlug) { setMessageType("warning"); setMessage("O projeto foi criado. Há alterações ainda não salvas."); return; }
    setCreatePanelOpen(true);
  }
  primaryActionRef.current = handlePrimaryAction;
  if (!allowed) { return null; }
  return <>
    <div data-maono-no-preview="true" data-maono-save-controller="true" data-maono-save-state={saving ? "saving" : saved ? "saved" : messageType === "error" ? "error" : "idle"} data-maono-preview-state={previewState} className="fixed bottom-6 right-6 z-[99998] flex flex-col items-end gap-3">
      {message && <div data-maono-save-message={messageType} role={messageType === "error" ? "alert" : "status"} aria-live="polite" className={`max-w-xl rounded-2xl border px-4 py-3 text-sm font-semibold text-white shadow-2xl ${messageType === "success" ? "border-emerald-300/50 bg-emerald-800/95" : messageType === "warning" ? "border-amber-300/50 bg-amber-900/95" : "border-red-300/50 bg-red-900/95"}`}>{message}</div>}
      {messageType === "error" && !saving && canOpenSupport && <button type="button" data-maono-save-action="support" onClick={openSupport} className="rounded-xl bg-slate-800 px-3 py-2 text-sm text-white">Abrir central de chamados</button>}
      {createdSlug && <button type="button" data-maono-save-action="open-created" onClick={() => window.open(`/projects/${encodeURIComponent(createdSlug)}/edit`, "_blank", "noopener,noreferrer")} className="rounded-xl bg-slate-800 px-3 py-2 text-sm text-white">Abrir projeto salvo</button>}
      {!terminalFailure && <button type="button" data-maono-save-action="primary" onClick={() => handlePrimaryAction()} disabled={saving || (!pending && !mapState)} aria-busy={saving} className="rounded-2xl border border-emerald-300/50 bg-emerald-600 px-5 py-4 text-sm font-extrabold text-white shadow-2xl disabled:opacity-60">
        <span className="inline-flex items-center justify-center gap-2">{saving && <UniversalLoader size="inline" accessibleLabel="Salvando projeto" />}<span data-maono-save-label="true">{saving ? "Salvando…" : saved ? "Salvo" : pending || messageType === "error" ? "Tentar novamente" : projectSlug ? "Salvar mapa" : "Salvar como projeto"}</span></span>
      </button>}
    </div>
    <ProjectCreatePanel open={createPanelOpen} organizationName={context?.organization?.name || (user as any)?.organization?.name || "Organização ativa"} initialName={creationDraft?.name} initialDescription={creationDraft?.description} busy={saving} phase={creationStage} error={creationError} canRetry={!terminalFailure} onSupport={canOpenSupport ? openSupport : undefined} onClose={() => { if (!saving) { setCreatePanelOpen(false); finishPendingMapSave("cancelled", "A criação foi fechada."); } }} onSubmit={handleCreateProject} />
  </>;
};
export default MaonoSaveButton;
