import { DocumentPreviewError } from "./document-preview-errors.ts";
export { DocumentPreviewError, previewErrorPresentation } from "./document-preview-errors.ts";
export type { PreviewErrorReason } from "./document-preview-errors.ts";

/** Private, bounded preview transport. Never opens provider/public viewer URLs. */
export const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_000_000;
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
};
export type PreviewFile = { id: number | string; name: string; size?: number; mimeType?: string };
export type PreviewProgress = { loaded: number; total: number | null };
export type PreviewContent = { blob: Blob; kind: "pdf" | "image"; width?: number; height?: number };
const invalid = () => new DocumentPreviewError("invalid");
const tooLarge = () => new DocumentPreviewError("too-large");
export function previewMime(file: PreviewFile): string {
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1].toLowerCase() || "";
  const mime = Object.hasOwn(MIME_BY_EXTENSION, extension) ? MIME_BY_EXTENSION[extension] : undefined;
  if (!mime) throw new DocumentPreviewError("unsupported");
  if (file.size != null && file.size > MAX_PREVIEW_BYTES) throw tooLarge();
  const declared = file.mimeType?.split(";")[0].trim().toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== mime) throw invalid();
  return mime;
}
function ascii(bytes: Uint8Array, start: number, length: number) { return String.fromCharCode(...bytes.subarray(start, start + length)); }
function dimensions(bytes: Uint8Array, mime: string): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/png" && bytes.length >= 24 && bytes[0] === 137 && ascii(bytes, 1, 7) === "PNG\r\n\x1a\n" && ascii(bytes, 12, 4) === "IHDR") return [view.getUint32(16), view.getUint32(20)];
  if (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
      offset += length;
    }
  }
  if (mime === "image/webp" && bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const chunk = ascii(bytes, 12, 4);
    const little24 = (offset: number) => bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
    // Animated WebP can allocate an unbounded series of decoded frames.
    if (chunk === "VP8X" && !(bytes[20] & 2)) return [1 + little24(24), 1 + little24(27)];
    if (chunk === "VP8 " && ascii(bytes, 23, 3) === "\x9d\x01\x2a") return [view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383];
    if (chunk === "VP8L" && bytes[20] === 47) return [1 + ((bytes[21] | (bytes[22] << 8)) & 16383), 1 + (((bytes[22] >> 6) | (bytes[23] << 2) | (bytes[24] << 10)) & 16383)];
  }
  throw invalid();
}
export function validatePreviewBytes(bytes: Uint8Array, mime: string): PreviewContent {
  if (bytes.length > MAX_PREVIEW_BYTES) throw tooLarge();
  if (mime === "application/pdf") {
    if (!/^%PDF-\d\.\d/.test(ascii(bytes, 0, 8))) throw invalid();
    return { kind: "pdf", blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }) };
  }
  const [width, height] = dimensions(bytes, mime);
  if (!width || !height || width > 12000 || height > 12000 || width * height > MAX_IMAGE_PIXELS) throw new DocumentPreviewError("image-too-large");
  // APNG is deliberately excluded too. The UI displays static images only.
  if (mime === "image/png") {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
      if (ascii(bytes, offset + 4, 4) === "acTL") throw invalid();
      if (length > bytes.length - offset - 12) throw invalid();
      offset += length + 12;
    }
  }
  return { kind: "image", width, height, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }) };
}

export async function loadDocumentPreview(organizationId: number | string, file: PreviewFile, signal: AbortSignal, onProgress: (progress: PreviewProgress) => void): Promise<PreviewContent> {
  const mime = previewMime(file);
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DocumentPreviewError("timeout")), 120_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(`/api/organizations/${encodeURIComponent(String(organizationId))}/files/${encodeURIComponent(String(file.id))}/download`, {
      credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new DocumentPreviewError("access");
      if (response.status === 404 || response.status === 410) throw new DocumentPreviewError("unavailable");
      throw new DocumentPreviewError("network");
    }
    const declared = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
    if (declared && declared !== "application/octet-stream" && declared !== mime) { await response.body?.cancel(); throw invalid(); }
    const length = Number(response.headers.get("Content-Length"));
    const total = Number.isSafeInteger(length) && length > 0 ? length : null;
    if (total && total > MAX_PREVIEW_BYTES) { await response.body?.cancel(); throw tooLarge(); }
    if (!response.body) throw invalid();
    reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let loaded = 0;
    onProgress({ loaded, total });
    while (true) {
      controller.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      if (loaded > MAX_PREVIEW_BYTES) throw tooLarge();
      chunks.push(value as Uint8Array<ArrayBuffer>);
      onProgress({ loaded, total: total && loaded <= total ? total : null });
    }
    controller.signal.throwIfAborted();
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return validatePreviewBytes(bytes, mime);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof DocumentPreviewError) throw error;
    throw new DocumentPreviewError("network");
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    controller.abort();
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
