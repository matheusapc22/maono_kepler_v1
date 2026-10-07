import type { DurableSaveSnapshot } from "../durable-save-store.ts";
/** PNG completion may annotate only the confirmation currently owning the UI. */
export type PreviewMessageOwner = { route: string; operationId: string; revision: number };
export function ownsPreviewMessage(current: PreviewMessageOwner | null, expected: PreviewMessageOwner) {
  return current?.route === expected.route && current.operationId === expected.operationId && current.revision === expected.revision;
}

/** JSON durability is already confirmed. Long PNG retries must not retain its
 * large Blob or the creation request body through completion callbacks. */
export function previewSnapshotWithoutPayload(snapshot: DurableSaveSnapshot): DurableSaveSnapshot {
  return { ...snapshot, serialized: { ...snapshot.serialized, body: null },
    ...(snapshot.creation ? { creation: { ...snapshot.creation, requestBody: null } } : {}) };
}
