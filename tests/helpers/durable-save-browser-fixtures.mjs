import { beginClientSaveAttempt } from "../../src/pages/Kepler/save-observability.ts";
import { prepareProjectUpdateSnapshot } from "../../src/pages/Kepler/durable-save-controller.ts";
export const scope = { actorId: "22", organizationId: "9", projectKey: "demo", projectId: "12" };
export function config(label = "Edição do clique") { return { version: "v1", config: { visState: { layers: [{ id: "a", config: { label } }] } }, datasets: [] }; }
export async function snapshot(overrides = {}) {
  return prepareProjectUpdateSnapshot({ attempt: beginClientSaveAttempt("update"), scope, projectSlug: "demo", config: config(), expectedConfigRevision: 7, editorSessionId: "editor-one", editGeneration: 2, ...overrides });
}
export function memoryStore() {
  const records = new Map();
  return { records, async put(record) { records.set(record.key, structuredClone(record)); }, async get(key) { const value = records.get(key); return value ? structuredClone(value) : null; }, async list(scope) { return [...records.values()].filter(value => value.scope.actorId === scope.actorId && value.scope.organizationId === scope.organizationId && value.scope.projectKey === scope.projectKey).map(value => structuredClone(value)); }, async listAccount(actorId, organizationId) { return [...records.values()].filter(value => value.scope.actorId === actorId && value.scope.organizationId === organizationId).map(value => structuredClone(value)); } };
}
export function receipt(value, revision = 8, overrides = {}) { return { operationId: value.manifest.operationId, organizationId: value.scope.organizationId, projectId: value.scope.projectId || 12, baseRevision: value.expectedConfigRevision, publishedRevision: revision, configRevision: revision, checksum: value.manifest.contentHash, checksumAlgorithm: value.manifest.checksumAlgorithm, sizeBytes: value.manifest.payloadBytes, committedAt: "2026-10-05T12:00:00.000Z", ...overrides }; }
export function response(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
export function status(state, extra = {}) { return response({ ok: true, operation: { state, ...extra } }); }
export function published(value, currentRevision = 8, extra = {}) { return response({ ok: true, configRevision: 8, project: { slug: value.projectSlug, id: 12, active: true, lifecycle: { state: "ACTIVE" } }, operation: { state: "PUBLISHED", receipt: receipt(value), currentRevision, ...extra } }); }
