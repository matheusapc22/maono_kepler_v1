import { parseResponseJson } from "../../lib/api-transport.ts";
import { beginClientSaveAttempt, buildSaveRequestHeaders, readSaveResponseDiagnostics, type ClientSaveAttempt, type SaveResponseDiagnostics } from "./save-observability.ts";
import { prepareProjectCreateTransport, type PreparedProjectCreateTransport } from "./project-create-transport.ts";
import { defaultDurableSaveStore, executePreparedProjectUpdate, prepareProjectUpdateSnapshot, receiptRevision, runWithSaveStallNotice, type SavePhase } from "./durable-save-controller.ts";
import { LocalSaveStorageError, type DurableSaveSnapshot, type DurableSaveStore } from "./durable-save-store.ts";
export type ProjectCreateRequestStage = "creating_record" | "preparing_files" | "finalizing";
export type ProjectCreateFlowResult = { response: Response; data: any; diagnostics: SaveResponseDiagnostics; prepared?: PreparedProjectCreateTransport; snapshot: DurableSaveSnapshot; transport: "inline" | "stream"; createdSlug: string; revision: number };
export class ProjectCreateFlowError extends Error {
  response: Response; data: any; diagnostics: SaveResponseDiagnostics; stage: ProjectCreateRequestStage; prepared?: PreparedProjectCreateTransport;
  constructor(message: string, context: { response: Response; data: any; diagnostics: SaveResponseDiagnostics; stage: ProjectCreateRequestStage; prepared?: PreparedProjectCreateTransport }) {
    super(message); this.name = "ProjectCreateFlowError"; this.response = context.response; this.data = context.data; this.diagnostics = context.diagnostics; this.stage = context.stage; this.prepared = context.prepared;
  }
}
export function isProjectCreationActive(data: any) {
  return Boolean(data?.status === "active" || data?.project?.active === true || (data?.lifecycle?.state ?? data?.project?.lifecycle?.state ?? data?.project?.lifecycleState ?? data?.operation?.receipt?.lifecycleState) === "ACTIVE");
}
async function executeCreate({ attempt, name, description, organizationId, actorId, idempotencyKey, config, editorSessionId, editGeneration, snapshot: recovery, store = defaultDurableSaveStore, fetchImpl = globalThis.fetch.bind(globalThis), signal, onPrepared = () => {}, onStage = () => {}, onPhase, isScopeCurrent = () => true }: {
  attempt: ClientSaveAttempt; name: string; description: string; organizationId: unknown; actorId: string; idempotencyKey: string; config: any;
  editorSessionId: string; editGeneration: number; legacy?: unknown; snapshot?: DurableSaveSnapshot; store?: DurableSaveStore; fetchImpl?: typeof fetch; signal?: AbortSignal;
  onStall?: () => void;
  onPrepared?: (prepared: PreparedProjectCreateTransport) => void; onStage?: (stage: ProjectCreateRequestStage) => void; onPhase?: (phase: SavePhase, data?: any) => void; isScopeCurrent?: () => boolean;
}): Promise<ProjectCreateFlowResult> {
  let prepared: PreparedProjectCreateTransport | undefined;
  let snapshot = recovery;
  if (!snapshot) {
    prepared = prepareProjectCreateTransport(attempt, { name, description, organizationId, idempotencyKey, config });
    onPrepared(prepared);
    snapshot = await prepareProjectUpdateSnapshot({ attempt, scope: { actorId, organizationId: String(organizationId), projectKey: `create:${idempotencyKey}` }, projectSlug: "", config, expectedConfigRevision: 0, editorSessionId, editGeneration, creation: { requestBody: prepared.requestBody, idempotencyKey }, transport: prepared.configTransport });
    await store.put(snapshot); // Reservation is never sent without the exact clicked snapshot on disk.
  }
  if (snapshot.scope.actorId !== actorId || snapshot.scope.organizationId !== String(organizationId) || !snapshot.creation) {
    throw new Error("A criação pertence a outra conta ou organização.");
  }
  if (!isScopeCurrent() || signal?.aborted) throw new DOMException("O contexto mudou.", "AbortError");
  // Without a known reservation, missing bytes cannot be completed and must not
  // allocate another inactive project/quota. A bound slug still queries its receipt.
  if (!snapshot.projectSlug && (!snapshot.serialized.body || snapshot.expiresAt <= Date.now())) {
    const error = new LocalSaveStorageError("LOCAL_SAVE_CREATION_PAYLOAD_UNAVAILABLE");
    onPhase?.("NEEDS_ACTION", { error: { code: error.code } });
    await store.put({ ...snapshot, localState: "expired", serialized: { ...snapshot.serialized, body: null } });
    throw error;
  }
  onStage("creating_record");
  if (!snapshot.projectSlug) {
    const requestAttempt = { ...snapshot.attempt, correlationId: beginClientSaveAttempt("create").correlationId };
    const response = await fetchImpl("/api/projects", { method: "POST", credentials: "include", headers: buildSaveRequestHeaders(requestAttempt), body: snapshot.creation.requestBody, signal });
    const parsed = await parseResponseJson(response);
    const data: any = parsed.valid ? parsed.data : null;
    const diagnostics = readSaveResponseDiagnostics(response, requestAttempt);
    if (!isScopeCurrent() || signal?.aborted) throw new DOMException("O contexto mudou.", "AbortError");
    if (!response.ok || !data?.project?.slug) throw new ProjectCreateFlowError(data?.error?.message || "A reserva não foi confirmada. A mesma tentativa poderá ser retomada.", { response, data, diagnostics, stage: "creating_record", prepared });
    snapshot = { ...snapshot, projectSlug: String(data.project.slug), headers: { ...snapshot.headers, ...(data.project.id != null ? { "X-Maono-Project-Id": String(data.project.id) } : {}) }, scope: { ...snapshot.scope, ...(data.project.id != null ? { projectId: String(data.project.id) } : {}) } };
    await store.put(snapshot);
  }
  onStage("preparing_files");
  const result = await executePreparedProjectUpdate({ snapshot, store, fetchImpl, signal, onPhase, isScopeCurrent });
  onStage("finalizing");
  if (!isProjectCreationActive(result.data)) throw new ProjectCreateFlowError("A publicação não confirmou que o projeto está ACTIVE. Consulte o recibo da mesma tentativa novamente.", { ...result, stage: "finalizing", prepared });
  return { ...result, prepared, transport: snapshot.manifest.payloadBytes > 8 * 1024 * 1024 ? "stream" : "inline", createdSlug: snapshot.projectSlug, revision: receiptRevision(result.data) };
}

export async function executeProjectCreateFlow(options: Parameters<typeof executeCreate>[0]) {
  return runWithSaveStallNotice({ onStall: options.onStall, operation: () => executeCreate(options) });
}
