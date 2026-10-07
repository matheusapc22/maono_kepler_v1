import { getSession } from "../../../lib/api";
import { beginClientSaveAttempt } from "../save-observability";
import { defaultDurableSaveStore } from "../durable-save-controller";
import { LOCAL_SAVE_RETENTION_MS, saveAccountKey, saveScopeKey, saveSnapshotKey, type DurableSaveSnapshot } from "../durable-save-store";
import { prepareReviewApplyArtifact } from "./review-apply-artifact";
import type { ProjectChangeReview } from "./review-api";

export async function submitDurableReviewApply(projectSlug: string, changeRequestId: string, review: ProjectChangeReview) {
  const session = await getSession();
  if (!session.authenticated || !session.user?.id) throw new Error("Entre novamente para recuperar a aplicação.");
  if (review.changeRequest.status === "applied" && Number.isInteger(review.changeRequest.appliedRevision)) {
    return {pending:false,appliedRevision:review.changeRequest.appliedRevision,payloadStored:true,review,idempotent:true};
  }
  const operationId = `change-request-${changeRequestId}`;
  const scope = { actorId:String(session.user.id), organizationId:String(review.changeRequest.organizationId), projectKey:`change-request:${projectSlug}:${changeRequestId}`, projectId:String(review.project.id) };
  const snapshotKey = saveSnapshotKey(scope, operationId);
  const operationUrl = `/api/projects/${encodeURIComponent(projectSlug)}/change-requests/${encodeURIComponent(changeRequestId)}/apply`;
  const headers = { "X-Maono-Client-Contract":"2", "X-Maono-Save-Id":operationId };
  const statusResponse = await fetch(operationUrl, {credentials:"include",cache:"no-store",headers});
  let operation: any = null;
  const statusPayload = await statusResponse.json();
  if (!(statusResponse.status === 404 && statusPayload?.error?.code === "SAVE_OPERATION_NOT_FOUND")) {
    const payload = statusPayload;
    if (!statusResponse.ok || payload.ok !== true) throw new Error(payload?.error?.message || "Não foi possível verificar a aplicação anterior.");
    operation = payload.operation;
  }
  let snapshot = await defaultDurableSaveStore.get(snapshotKey);
  if (operation?.state === "PUBLISHED") {
    const receipt = operation.receipt;
    if (!receipt || receipt.operationId !== operationId || String(receipt.projectId) !== scope.projectId || String(receipt.organizationId) !== scope.organizationId ||
        (snapshot && (receipt.checksum !== snapshot.manifest.contentHash || receipt.sizeBytes !== snapshot.manifest.payloadBytes || receipt.baseRevision !== snapshot.expectedConfigRevision))) {
      throw new Error("O recibo não corresponde à proposta aprovada.");
    }
    if (snapshot) await defaultDurableSaveStore.put({...snapshot,localState:"confirmed",receipt,serialized:{...snapshot.serialized,body:null}});
    return { operation, pending:false, appliedRevision:Number(receipt.publishedRevision), payloadStored:true };
  }
  if (["CONFLICT","FAILED_FINAL"].includes(operation?.state)) throw new Error("A aplicação precisa de revisão. A proposta foi preservada e não será sobrescrita.");
  if (operation && operation.state !== "AWAITING_UPLOAD") {
    return { operation,pending:true,appliedRevision:null,payloadStored:Boolean(operation.payloadStored) };
  }
  if (!snapshot && review.changesEnabled) {
    const prepared = await prepareReviewApplyArtifact(projectSlug,changeRequestId);
    const attempt = {...beginClientSaveAttempt("update"),saveId:operationId};
    const { ["X-Maono-Config-Checksum"]: _checksum, ["X-Maono-Change-Request-Version"]: _version, ...persistedHeaders } = prepared.headers;
    void _checksum; void _version;
    snapshot = {
      key:snapshotKey,scopeKey:saveScopeKey(scope),accountKey:saveAccountKey(scope.actorId,scope.organizationId),scope,
      attempt,projectSlug,expectedConfigRevision:prepared.artifact.baseRevision,
      manifest:{operationId,operation:"change_request",expectedConfigRevision:prepared.artifact.baseRevision,payloadBytes:prepared.body.size,contentHash:prepared.artifact.checksum,
        checksumAlgorithm:"dropbox-content-hash",serializationVersion:1,schemaName:"legacy-kepler",schemaVersion:1,
        configVersion:prepared.headers["X-Maono-Config-Version"],datasetCount:Number(prepared.headers["X-Maono-Dataset-Count"])},
      headers:{...persistedHeaders,...headers},serialized:{body:prepared.body,payloadBytes:prepared.body.size,serializeDurationMs:0,totalDurationMs:0},
      editorSessionId:operationId,editGeneration:0,createdAt:Date.now(),expiresAt:Date.now()+LOCAL_SAVE_RETENTION_MS,localState:"pending",
    } satisfies DurableSaveSnapshot;
    await defaultDurableSaveStore.put(snapshot);
  }
  if (snapshot && (!snapshot.serialized.body || snapshot.localState === "expired")) throw new Error("A cópia local desta tentativa expirou. Preserve a proposta e revise a aplicação antes de tentar novamente.");
  // Recheck identity immediately before transmitting a persisted account-scoped payload.
  const current = await getSession();
  if (!current.authenticated || String(current.user?.id) !== scope.actorId) throw new Error("A conta mudou. A tentativa anterior continua preservada na conta original.");
  const response = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/change-requests/${encodeURIComponent(changeRequestId)}/apply`, {
    method:"POST",credentials:"include",cache:"no-store",
    headers:snapshot ? {...snapshot.headers,"X-Maono-Config-Checksum":snapshot.manifest.contentHash,"X-Correlation-Id":crypto.randomUUID()} : headers,
    body:snapshot?.serialized.body ?? undefined,
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(result?.error?.message || "A aplicação não foi confirmada. A tentativa permanece disponível para consulta.");
  if (result.operation?.state === "PUBLISHED" && snapshot) {
    const receipt = result.operation.receipt;
    if (!receipt || receipt.operationId !== operationId || String(receipt.projectId)!==scope.projectId || String(receipt.organizationId)!==scope.organizationId ||
        receipt.baseRevision!==snapshot.expectedConfigRevision || receipt.checksum!==snapshot.manifest.contentHash || receipt.checksumAlgorithm!==snapshot.manifest.checksumAlgorithm || receipt.sizeBytes!==snapshot.manifest.payloadBytes) {
      throw new Error("O recibo não corresponde à proposta aprovada.");
    }
    await defaultDurableSaveStore.put({...snapshot,localState:"confirmed",receipt,serialized:{...snapshot.serialized,body:null}});
  }
  return {...result,payloadStored:Boolean(result.operation?.payloadStored || result.operation?.state==="PUBLISHED")};
}
