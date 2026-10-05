import React, { useEffect, useRef, useState } from "react";
import { useSelector, useStore } from "react-redux";
import { useNavigate, useParams } from "react-router";
import { useSession } from "../../../auth/session";
import { buildApiError } from "../../../lib/api-transport";
import { normalizeUserError } from "../../../lib/user-error-catalog";
import { UniversalLoader } from "../../../components/loading";
import { serializeProjectConfig } from "../thumbnail/capture-thumbnail";
import { getMaonoConfigForSave, subscribePointClusterStore } from "../clustering/point-cluster-store";
import { enqueueProjectThumbnailJob } from "../thumbnail/background-thumbnail-job";
import ProjectCreatePanel, { type ProjectCreateInput, type ProjectCreationStage } from "./project-create-panel";
import { useKeplerEngineAdapter } from "../engine-adapter";
import { useMapPanel } from "../map-panel/MapPanelContext";
import { emitMapSaveResult, MAONO_MAP_SAVE_REQUEST_EVENT, mapSaveRequestFromEvent, mapSaveSourceAnalysisKind, type MapSaveRequestDetail, type MapSaveResultStatus } from "../map-panel/map-save-events";
import { emitMapPanelTelemetry } from "../map-panel/map-panel-telemetry";
import { beginClientSaveAttempt, clientSaveTotalDurationMs } from "../save-observability";
import { createSaveEditGeneration } from "../save-edit-generation";
import { executeProjectCreateFlow } from "../project-create-flow";
import { confirmationMatchesEditor, defaultDurableSaveStore, DurableSaveError, executePreparedProjectUpdate, isSaveRequestAbort, operationState, prepareProjectUpdateSnapshot, receiptRevision, type SavePhase, type ProjectUpdateFlowResult } from "../durable-save-controller";
import { saveAccountKey, isPendingSaveSnapshot, archiveReviewedSaveSnapshot, snapshotMatchesProject, type DurableSaveSnapshot } from "../durable-save-store";

const ASYNC_THUMBNAIL_ENABLED = String(import.meta.env.VITE_ASYNC_PROJECT_THUMBNAIL ?? "true").toLowerCase() !== "false";
function activeOrganizationId(user: any) { return user?.activeOrganizationId ?? user?.active_organization_id ?? user?.organizationId ?? user?.organization_id ?? user?.organization?.id ?? null; }
function emitSaveTelemetry(event: string, details: Parameters<typeof emitMapPanelTelemetry>[1] = {}) {
  try { emitMapPanelTelemetry(event, details); } catch { /* Telemetry never changes a committed result. */ }
}
function getSaveFailureMessage(error: unknown) {
  // Local warnings use stable catalog codes; remote failures never supply public copy.
  const presentation = normalizeUserError(error instanceof DurableSaveError && !error.code ? buildApiError(error.response, error.data) : error);
  return presentation.supportReference ? `${presentation.message} Referência: ${presentation.supportReference}.` : presentation.message;
}
function exportBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const controllerRef = useRef<AbortController | null>(null);
  const primaryActionRef = useRef<(request?: MapSaveRequestDetail | null) => void>(() => {});
  const resumeRef = useRef<(snapshot: DurableSaveSnapshot) => Promise<void>>(async () => {});
  const pendingSaveRequestRef = useRef<MapSaveRequestDetail | null>(null);
  const commandsRef = useRef(commands); commandsRef.current = commands;
  const transientIdsRef = useRef(engineState.transientDatasetIds); transientIdsRef.current = engineState.transientDatasetIds;
  const [pending, setPending] = useState<DurableSaveSnapshot | null>(null);
  const pendingSnapshotRef = useRef<DurableSaveSnapshot | null>(null);
  pendingSnapshotRef.current = pending;
  const [archived, setArchived] = useState<DurableSaveSnapshot | null>(null);
  const exportableSnapshot = pending ?? archived;
  const [saving, setSaving] = useState(false);
  const [saveStalled, setSaveStalled] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "warning" | "error">("success");
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [creationStage, setCreationStageValue] = useState<ProjectCreationStage>("ready");
  const creationStageRef = useRef<ProjectCreationStage>("ready");
  const [creationFailedStage, setCreationFailedStage] = useState<Exclude<ProjectCreationStage, "ready" | "success" | "error"> | null>(null);
  function setCreationStage(stage: ProjectCreationStage) { creationStageRef.current = stage; setCreationStageValue(stage); }
  function markCreationFailure() {
    const stage = creationStageRef.current;
    setCreationFailedStage(stage === "ready" || stage === "success" || stage === "error" ? null : stage);
    setCreationStage("error");
  }
  const [creationError, setCreationError] = useState<string | null>(null);
  const [creationDraft, setCreationDraft] = useState<ProjectCreateInput | null>(null);
  const [createdSlug, setCreatedSlug] = useState<string | null>(null);
  const allowed = Boolean(authenticated && actorId && organizationId && context?.capabilities?.saveMap && String(context?.organization?.id ?? "") === organizationId && (!projectSlug || Boolean(projectId)));

  // Observe edits synchronously, before React rendering. Only a Save click serializes/persists a snapshot.
  useEffect(() => {
    const observer = createSaveEditGeneration(reduxStore.getState()?.demo?.keplerGl?.map);
    const baseGeneration = editGeneration.current;
    const unsubscribe = reduxStore.subscribe(() => {
      editGeneration.current = baseGeneration + observer.observe(reduxStore.getState()?.demo?.keplerGl?.map);
    });
    const unsubscribeClustering = subscribePointClusterStore(() => {
      editGeneration.current = baseGeneration + observer.observeExtensionChange();
    });
    return () => { unsubscribe(); unsubscribeClustering(); };
  }, [reduxStore]);

  useEffect(() => {
    const controller = new AbortController();
    const scopeAtStart = routeKey;
    setPending(null); setArchived(null); setMessage(""); setCreatedSlug(null); setSaving(false); setSaveStalled(false);
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
        const orphan = records.find(value => value.manifest.operation !== "change_request" && projectSlug && value.projectSlug === projectSlug && value.scope.projectId !== projectId);
        setArchived(orphan ?? [...records].reverse().find(value => value.resolvedAt && value.manifest.operation !== "change_request" && (projectSlug ? value.projectSlug === projectSlug : value.manifest.operation === "create")) ?? null);
        if (!snapshot && orphan) { setMessageType("warning"); setMessage("Uma tentativa pertence ao projeto anterior que usava este endereço. Ela não será enviada a este projeto. Exporte a tentativa antiga para revisão."); }
        if (snapshot && !["conflict", "failed"].includes(snapshot.localState)) await resumeRef.current(snapshot);
        else if (snapshot) {
          setMessageType("warning"); setMessage("Há uma tentativa que precisa de revisão. A cópia do clique foi preservada por até 7 dias; exporte-a antes de atualizar a página.");
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
  function phaseChanged(phase: SavePhase, data?: any) {
    setMessageType("warning");
    if (phase === "SENDING") setMessage("Enviando o mapa. Mantenha esta página aberta.");
    if (phase === "LOCAL_READY") setMessage("Tentativa preservada neste navegador por até 7 dias. Preparando o envio.");
    if (phase === "CHECKING") setMessage(["PAYLOAD_STORED", "PROCESSING", "RETRY_WAIT"].includes(operationState(data))
      ? "Mapa recebido. Você pode sair; a confirmação será recuperada ao voltar."
      : "Verificando o resultado da mesma tentativa de salvamento.");
  }
  async function accepted(result: ProjectUpdateFlowResult, recovery: boolean, route: string, clickedMapState?: any) {
    if (contextRef.current !== route) return;
    const snapshot = result.snapshot;
    const revision = receiptRevision(result.data);
    const currentRevision = Number(result.data?.operation?.currentRevision ?? result.data?.currentRevision ?? revision);
    const matches = confirmationMatchesEditor(snapshot, editorSessionId.current, editGeneration.current) && currentRevision === revision;
    if (matches) expectedRevisionRef.current = { route, revision };
    setPending(null);
    emitSaveTelemetry(recovery ? "map_save_recovery_succeeded" : "map_save_succeeded", { operation: snapshot.attempt.operation, saveId: snapshot.attempt.saveId, correlationId: result.diagnostics.correlationId, expectedRevision: snapshot.expectedConfigRevision, candidateRevision: revision, snapshotMatchesCurrent: matches, payloadBytes: snapshot.manifest.payloadBytes, serializeDurationMs: snapshot.serialized.serializeDurationMs, httpStatus: result.response.status, serverTiming: result.diagnostics.serverTiming, durationMs: clientSaveTotalDurationMs(snapshot.attempt) });
    setMessageType(matches ? "success" : "warning");
    setMessage(currentRevision > revision
      ? `Sua tentativa foi salva na revisão ${revision}. O projeto já está na revisão ${currentRevision}; o rascunho atual foi mantido.`
      : matches ? `Projeto salvo na revisão ${revision}.` : `A tentativa foi salva na revisão ${revision}. Há alterações locais que não foram confirmadas; o rascunho atual foi mantido.`);
    if (result.data?.localCleanupWarning) { setMessageType("warning"); setMessage(`Projeto salvo na revisão ${revision}. O navegador não conseguiu remover a cópia local; a próxima consulta verificará o mesmo recibo.`); }
    finishPendingMapSave("success", null, matches);
    if (typeof BroadcastChannel !== "undefined") { const channel = new BroadcastChannel(`maono-save:${accountKey}`); channel.postMessage({ operationId: snapshot.manifest.operationId }); channel.close(); }
    // PR 222: PNG is an independent best-effort job, never a condition for map success.
    if (ASYNC_THUMBNAIL_ENABLED && snapshot.serialized.body && currentRevision === revision) {
      try {
      const config = JSON.parse(await snapshot.serialized.body.text());
      if (contextRef.current !== route) return;
      void enqueueProjectThumbnailJob({ slug: snapshot.projectSlug, organizationId: snapshot.scope.organizationId, revision, mapState: clickedMapState ?? mapState, savedConfig: config,
        onState: state => {
          if (contextRef.current !== route || !confirmationMatchesEditor(snapshot, editorSessionId.current, editGeneration.current)) return;
          if (state === "READY") { setMessageType("success"); setMessage(`Projeto salvo na revisão ${revision}. A visualização PNG já foi atualizada.`); }
          if (state === "FAILED") { setMessageType("warning"); setMessage(`Projeto salvo na revisão ${revision}, mas a visualização PNG não pôde ser atualizada. O mapa continua disponível.`); }
        },
      });
      } catch {
        if (contextRef.current === route) { setMessageType("warning"); setMessage(`Projeto salvo na revisão ${revision}, mas a visualização PNG não pôde ser preparada. O mapa continua disponível.`); }
      }
    }
  }
  async function runSnapshot(snapshot: DurableSaveSnapshot, recovery = true, clickedMapState?: any) {
    if (operationInFlightRef.current || !allowed) return;
    if (snapshot.scope.actorId !== actorId || snapshot.scope.organizationId !== organizationId || (projectSlug && !snapshotMatchesProject(snapshot, actorId, organizationId, projectSlug, projectId))) return;
    const route = routeKey;
    const controller = new AbortController(); controllerRef.current = controller;
    operationInFlightRef.current = true; setSaving(true); setSaveStalled(false); setPending(snapshot);
    const current = () => contextRef.current === route;
    if (recovery) emitSaveTelemetry("map_save_recovery_requested", { operation: snapshot.attempt.operation, saveId: snapshot.attempt.saveId, expectedRevision: snapshot.expectedConfigRevision });
    const onStall = () => { if (current()) { setSaveStalled(true); emitSaveTelemetry("map_save_stalled", { saveId: snapshot.attempt.saveId, operation: snapshot.attempt.operation, payloadBytes: snapshot.manifest.payloadBytes }); } };
    try {
      const common = { snapshot, signal: controller.signal, isScopeCurrent: current, onPhase: (phase: SavePhase, data?: any) => { if (current()) phaseChanged(phase, data); } };
      let result: ProjectUpdateFlowResult;
      if (snapshot.attempt.operation === "create") {
        const created = await executeProjectCreateFlow({ ...common, attempt: snapshot.attempt, actorId, organizationId, idempotencyKey: snapshot.creation!.idempotencyKey, name: "", description: "", config: null, editorSessionId: editorSessionId.current, editGeneration: editGeneration.current, onStage: stage => { if (current()) setCreationStage(stage); }, onStall });
        result = created;
        if (current()) { setCreationStage("success"); setCreatePanelOpen(false); setCreatedSlug(created.createdSlug); }
      } else {
        result = await executePreparedProjectUpdate({ ...common, scope: { ...snapshot.scope, actorId, organizationId, projectId }, onStall });
      }
      await accepted(result, recovery, route, clickedMapState);
      if (snapshot.attempt.operation === "create" && current() && confirmationMatchesEditor(snapshot, editorSessionId.current, editGeneration.current)) navigate(`/projects/${encodeURIComponent(snapshot.projectSlug || result.snapshot.projectSlug)}/edit`, { replace: true });
    } catch (error) {
      if (!current()) return;
      const conflict = error instanceof DurableSaveError && (operationState(error.data) === "CONFLICT" || error.response.status === 409);
      const stored = await defaultDurableSaveStore.get(snapshot.key).catch(() => null);
      if (!current()) return;
      setPending(stored ?? snapshot); setMessageType(conflict ? "error" : "warning");
      const failure = isSaveRequestAbort(error)
        ? "A espera foi interrompida; isso não cancela um salvamento já recebido. A mesma tentativa será verificada ao retomar."
        : `${getSaveFailureMessage(error)} A tentativa anterior foi preservada para verificar o resultado.`;
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
      if (current()) { setSaving(false); setSaveStalled(false); }
    }
  }
  resumeRef.current = snapshot => runSnapshot(snapshot, true);

  async function handleExistingProjectSave() {
    if (!allowed || !projectSlug) return;
    if (pending) { await runSnapshot(pending); return; }
    if (operationInFlightRef.current) return;
    const route = routeKey;
    operationInFlightRef.current = true; setSaving(true);
    try {
      const clicked = captureClickedConfig();
      const attempt = beginClientSaveAttempt("update");
      emitSaveTelemetry("map_save_requested", { operation: "update", saveId: attempt.saveId, correlationId: attempt.correlationId });
      const snapshot = await prepareProjectUpdateSnapshot({ attempt, scope: { actorId, organizationId, projectKey: `project:${projectId}`, projectId }, projectSlug, config: clicked.config, expectedConfigRevision: expectedRevisionRef.current!.revision, editorSessionId: editorSessionId.current, editGeneration: clicked.generation });
      if (contextRef.current !== route) return;
      await defaultDurableSaveStore.put(snapshot);
      emitSaveTelemetry("map_save_serialized", { operation: "update", saveId: attempt.saveId, payloadBytes: snapshot.manifest.payloadBytes, serializeDurationMs: snapshot.serialized.serializeDurationMs, expectedRevision: snapshot.expectedConfigRevision });
      operationInFlightRef.current = false; await runSnapshot(snapshot, false, clicked.mapState);
    } catch (error) {
      if (contextRef.current === route) { setMessageType("error"); setMessage(getSaveFailureMessage(error)); finishPendingMapSave("error", getSaveFailureMessage(error)); }
    } finally { operationInFlightRef.current = false; if (contextRef.current === route) setSaving(false); }
  }
  async function handleCreateProject(input: ProjectCreateInput) {
    if (!allowed || operationInFlightRef.current) return;
    if (pending) { await runSnapshot(pending); return; }
    const route = routeKey;
    operationInFlightRef.current = true; setSaving(true); setCreationDraft(input); setCreationError(null); setCreationFailedStage(null); setCreationStage("creating_record");
    try {
      const clicked = captureClickedConfig();
      const attempt = beginClientSaveAttempt("create");
      emitSaveTelemetry("map_save_requested", { operation: "create", saveId: attempt.saveId, correlationId: attempt.correlationId });
      const result = await executeProjectCreateFlow({ attempt, name: input.name, description: input.description, actorId, organizationId, idempotencyKey: `project-create:${attempt.saveId}`, config: clicked.config, editorSessionId: editorSessionId.current, editGeneration: clicked.generation, isScopeCurrent: () => contextRef.current === route,
        signal: (controllerRef.current = new AbortController()).signal,
        onStage: stage => { if (contextRef.current === route) setCreationStage(stage); }, onPhase: (phase, data) => { if (contextRef.current === route) phaseChanged(phase, data); }, onStall: () => { if (contextRef.current === route) setSaveStalled(true); },
        onPrepared: prepared => emitSaveTelemetry("map_save_serialized", { operation: "create", saveId: attempt.saveId, payloadBytes: prepared.configPayloadBytes, serializeDurationMs: prepared.serializeDurationMs, transport: prepared.large ? "stream" : "inline" }),
      });
      if (contextRef.current !== route) return;
      setCreationStage("success"); setCreatePanelOpen(false); setCreatedSlug(result.createdSlug);
      await accepted(result, false, route, clicked.mapState);
      if (confirmationMatchesEditor(result.snapshot, editorSessionId.current, editGeneration.current)) navigate(`/projects/${encodeURIComponent(result.createdSlug)}/edit`, { replace: true });
    } catch (error) {
      if (contextRef.current !== route) return;
      const records = await defaultDurableSaveStore.listAccount(actorId, organizationId).catch(() => []);
      if (contextRef.current !== route) return;
      setPending(records.find(value => value.manifest.operation === "create" && isPendingSaveSnapshot(value)) ?? null);
      const failure = isSaveRequestAbort(error) ? "A espera foi interrompida. A mesma criação será consultada ao retomar." : getSaveFailureMessage(error);
      markCreationFailure(); setCreationError(failure); setMessageType("warning"); setMessage(failure);
      emitSaveTelemetry("map_save_failed", { operation: "create", retryable: true });
    } finally { operationInFlightRef.current = false; controllerRef.current = null; if (contextRef.current === route) { setSaving(false); setSaveStalled(false); } }
  }
  function handlePrimaryAction(request: MapSaveRequestDetail | null = null) {
    if (pending) { void runSnapshot(pending); return; }
    if (!request && transientIdsRef.current.length > 0) { setMessageType("error"); setMessage("Confirme ou descarte a prévia de análise antes de salvar o mapa."); return; }
    if (projectSlug) { void handleExistingProjectSave(); return; }
    if (createdSlug) { setMessageType("warning"); setMessage("O projeto já foi criado. Exporte as edições posteriores antes de abrir o projeto salvo."); return; }
    setCreatePanelOpen(true);
  }
  primaryActionRef.current = handlePrimaryAction;
  async function archiveReviewedAttempt() {
    if (!pending || saving) return;
    try {
      await archiveReviewedSaveSnapshot(defaultDurableSaveStore, pending);
      setArchived(pending); setPending(null); setCreationError(null); setCreationFailedStage(null); setCreationStage("ready");
      setMessageType("warning");
      setMessage("Tentativa arquivada para revisão; a cópia permanece disponível por até 7 dias. Exporte seu rascunho antes de recarregar a revisão atual. A revisão-base não foi alterada automaticamente.");
    } catch (error) { setMessageType("error"); setMessage(getSaveFailureMessage(error)); }
  }
  function exportCurrentDraft() {
    try { exportBlob(new Blob([JSON.stringify(captureClickedConfig().config)], { type: "application/json" }), `${projectSlug || "mapa"}-rascunho.json`); }
    catch (error) { setMessageType("error"); setMessage(getSaveFailureMessage(error)); }
  }
  if (!allowed) { return null; }
  return <>
    <div data-maono-no-preview="true" className="fixed bottom-6 right-6 z-[99998] flex flex-col items-end gap-3">
      {message && <div role={messageType === "error" ? "alert" : "status"} aria-live="polite" className={`max-w-xl rounded-2xl border px-4 py-3 text-sm font-semibold text-white shadow-2xl ${messageType === "success" ? "border-emerald-300/50 bg-emerald-800/95" : messageType === "warning" ? "border-amber-300/50 bg-amber-900/95" : "border-red-300/50 bg-red-900/95"}`}>{message}</div>}
      {pending && <p className="max-w-xl rounded-xl bg-slate-900/95 px-3 py-2 text-xs text-white">A cópia deste clique fica nesta conta e neste navegador por até 7 dias, mesmo após sair da conta. Edições posteriores ainda não estão nessa cópia.</p>}
      {(exportableSnapshot || messageType !== "success") && <div className="flex gap-2">
        <button type="button" onClick={exportCurrentDraft} className="rounded-xl bg-slate-800 px-3 py-2 text-sm text-white">Exportar rascunho atual</button>
        {exportableSnapshot?.serialized.body && <button type="button" onClick={() => exportBlob(exportableSnapshot.serialized.body!, `${exportableSnapshot.projectSlug || "mapa"}-tentativa.json`)} className="rounded-xl bg-slate-800 px-3 py-2 text-sm text-white">Exportar tentativa</button>}
      </div>}
      {pending && ["conflict", "failed", "expired"].includes(pending.localState) && <button type="button" disabled={saving} onClick={() => void archiveReviewedAttempt()} className="rounded-xl bg-slate-800 px-3 py-2 text-sm text-white">Arquivar tentativa revisada e liberar novos salvamentos</button>}
      {createdSlug && <button type="button" onClick={() => navigate(`/projects/${encodeURIComponent(createdSlug)}/edit`)} className="rounded-xl bg-slate-800 px-3 py-2 text-sm text-white">Abrir projeto salvo (exporte o rascunho antes)</button>}
      {saving && saveStalled && <button type="button" onClick={() => controllerRef.current?.abort()} className="rounded-2xl border border-amber-300/60 bg-amber-900/95 px-4 py-3 font-extrabold text-white">Parar de esperar</button>}
      <button type="button" onClick={() => handlePrimaryAction()} disabled={saving || (!pending && !mapState)} aria-busy={saving} className="rounded-2xl border border-emerald-300/50 bg-emerald-600 px-5 py-4 text-sm font-extrabold text-white shadow-2xl disabled:opacity-60">
        <span className="inline-flex items-center justify-center gap-2">{saving && <UniversalLoader size="inline" accessibleLabel={pending ? "Verificando salvamento" : "Salvando projeto"} />}<span>{pending ? "Verificar tentativa anterior" : projectSlug ? "Salvar na Maõno" : "Salvar como projeto"}</span></span>
      </button>
    </div>
    <ProjectCreatePanel open={createPanelOpen} organizationName={context?.organization?.name || (user as any)?.organization?.name || "Organização ativa"} initialName={creationDraft?.name} initialDescription={creationDraft?.description} busy={saving} stalled={saveStalled} phase={creationStage} failedStage={creationFailedStage} error={creationError} onCancelWait={() => controllerRef.current?.abort()} onClose={() => { if (!saving) { setCreatePanelOpen(false); finishPendingMapSave("cancelled", "A criação foi fechada."); } }} onSubmit={handleCreateProject} />
  </>;
};
export default MaonoSaveButton;
