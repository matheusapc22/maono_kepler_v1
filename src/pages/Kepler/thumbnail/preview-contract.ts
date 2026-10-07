/** A preview belongs to one published save and one frozen render generation. */
export const PREVIEW_RENDERER_VERSION = "maono-png-v2";
export type PreviewIdentity = {
  operationId: string;
  saveOperationId: string;
  organizationId: string;
  projectId: string;
  revision: number;
  configChecksum: string;
  editorSessionId: string;
  editGeneration: number;
  rendererVersion: string;
};
export type PreviewManifest = PreviewIdentity & {
  imageChecksum: string;
  sizeBytes: number;
  captureMethod: string;
};
export type PreviewOperationState = "WAITING_CAPTURE" | "RECEIVING" | "PAYLOAD_STORED" | "PROCESSING" | "RETRY_WAIT" | "READY" | "FAILED_FINAL" | "SUPERSEDED";
export type PreviewReceipt = {
  operationId: string;
  saveOperationId: string;
  organizationId: number | string;
  projectId: number | string;
  revision: number;
  configChecksum: string;
  imageChecksum: string;
  artifactId: string;
  sizeBytes: number;
};
export type PreviewOperation = {
  operationId: string;
  state: PreviewOperationState;
  payloadStored: boolean;
  receipt: PreviewReceipt | null;
  nextAttemptAt?: number | null;
  errorCode?: string | null;
};
export function previewReceiptMatches(manifest: PreviewManifest, receipt: PreviewReceipt | null | undefined) {
  return Boolean(receipt && receipt.operationId === manifest.operationId && receipt.saveOperationId === manifest.saveOperationId &&
    String(receipt.organizationId) === manifest.organizationId && String(receipt.projectId) === manifest.projectId &&
    receipt.revision === manifest.revision && receipt.configChecksum === manifest.configChecksum &&
    receipt.imageChecksum === manifest.imageChecksum && receipt.sizeBytes === manifest.sizeBytes && receipt.artifactId);
}
export async function hashPreviewBlob(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
