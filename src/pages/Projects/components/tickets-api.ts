import {
  buildApiError,
  buildClientApiError,
  buildHttpApiError,
  parseResponseJson,
  requestJson,
} from "../../../lib/api-transport";
import {
  ApiError,
  apiErrorDiagnostic,
  getXhrErrorReference,
  isApiError,
  type ApiErrorDiagnostic,
} from "../../../lib/error-contract";
import { normalizeUserError } from "../../../lib/user-error-catalog";

import type {
  CreateTicketPayload,
  TicketCommand,
  Ticket,
  TicketAttachment,
  TicketAttachmentUploadSession,
  TicketConversationDraft,
  TicketConversationKind,
  TicketConversationMessage,
  TicketConversationRevision,
  TicketDetailResponse,
  TicketFilters,
  TicketListResponse,
  UpdateTicketPayload,
} from "./ticket-types";

type UploadOptions = {
  signal?: AbortSignal;
  draftId?: string;
  onProgress?: (progress: number) => void;
  onPhase?: (phase: "hashing" | "resuming" | "uploading" | "finalizing") => void;
};

export class TicketApiError extends ApiError {
  constructor(diagnostic: ApiErrorDiagnostic, payload: unknown = null) {
    super(diagnostic, payload, normalizeUserError(diagnostic).message);
    this.name = "TicketApiError";
  }
}

export function toTicketApiError(
  error: unknown,
  fallback = "Não foi possível concluir a operação.",
) {
  if (error instanceof TicketApiError) return error;

  if (isApiError(error)) {
    const diagnostic = apiErrorDiagnostic(error);
    if (diagnostic) {
      return new TicketApiError(diagnostic, error.payload);
    }
  }

  return new TicketApiError(
    {
      status: 0,
      code: "TICKET_CLIENT_ERROR",
      category: "INFRASTRUCTURE",
      retryable: false,
    },
    { fallback },
  );
}

function pathSegment(value: number | string) {
  return encodeURIComponent(String(value));
}

function ticketsPath(organizationId: number | string) {
  return `/api/organizations/${pathSegment(organizationId)}/tickets`;
}

async function responseError(response: Response) {
  const parsed = await parseResponseJson(response);
  return toTicketApiError(
    buildApiError(response, parsed.valid ? parsed.data : null),
  );
}

export function listTickets(
  organizationId: number | string,
  filters: TicketFilters,
  page = 1,
  signal?: AbortSignal,
  options: {
    limit?: number;
    includeUndated?: boolean;
  } = {},
) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.assigneeId) params.set("assigneeId", filters.assigneeId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.overdueOnly) params.set("overdueOnly", "1");
  params.set("sort", filters.sort);
  params.set("page", String(page));
  params.set("limit", String(options.limit || 50));
  if (options.includeUndated) params.set("includeUndated", "1");

  return requestJson<TicketListResponse>(
    `${ticketsPath(organizationId)}?${params.toString()}`,
    { signal },
  );
}

function validatedTicketResponse(ticket: Ticket | undefined, organizationId: number | string, expectedId?: number | string, requireEtag = false): Ticket {
  if (!ticket || ticket.id == null || String(ticket.organizationId) !== String(organizationId) ||
      expectedId != null && String(ticket.id) !== String(expectedId) ||
      typeof ticket.code !== "string" || requireEtag && !ticket.etag) {
    throw toTicketApiError(buildClientApiError({ status: 502, code: "TICKET_RESPONSE_INVALID", category: "INFRASTRUCTURE", retryable: true }));
  }
  return ticket;
}

export async function createTicket(
  organizationId: number | string,
  payload: CreateTicketPayload,
  signal?: AbortSignal,
  options: { idempotencyKey?: string } = {},
) {
  const response = await requestJson<{ ok: boolean; ticket: Ticket }>(
    ticketsPath(organizationId),
    {
      method: "POST",
      headers: options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
      body: JSON.stringify(payload),
      signal,
    },
  );
  return validatedTicketResponse(response.ticket, organizationId, undefined, Boolean(options.idempotencyKey));
}

export function getTicketDetails(
  organizationId: number | string,
  ticketId: number | string,
  signal?: AbortSignal,
) {
  return requestJson<TicketDetailResponse>(
    `${ticketsPath(organizationId)}/${pathSegment(ticketId)}`,
    { signal },
  );
}

function ticketConversationPath(
  organizationId: number | string,
  ticketId: number | string,
) {
  return `${ticketsPath(organizationId)}/${pathSegment(ticketId)}`;
}

export function listTicketConversationMessages(
  organizationId: number | string,
  ticketId: number | string,
  cursor?: string | null,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ limit: "30" });
  if (cursor) params.set("cursor", cursor);
  return requestJson<{
    ok: boolean;
    messages: TicketConversationMessage[];
    nextCursor?: string | null;
    hasMore: boolean;
  }>(`${ticketConversationPath(organizationId, ticketId)}/messages?${params.toString()}`, { signal });
}

export function createTicketConversationDraft(
  organizationId: number | string,
  ticketId: number | string,
  payload: { kind: TicketConversationKind; body?: string },
  signal?: AbortSignal,
) {
  return requestJson<{ ok: boolean; draft: TicketConversationDraft }>(
    `${ticketConversationPath(organizationId, ticketId)}/drafts`,
    { method: "POST", body: JSON.stringify(payload), signal },
  ).then((response) => response.draft);
}

export function updateTicketConversationDraft(
  organizationId: number | string,
  ticketId: number | string,
  draftId: string,
  body: string,
  etag: string,
  signal?: AbortSignal,
) {
  return requestJson<{ ok: boolean; draft: TicketConversationDraft }>(
    `${ticketConversationPath(organizationId, ticketId)}/drafts/${pathSegment(draftId)}`,
    { method: "PATCH", headers: { "If-Match": etag }, body: JSON.stringify({ body }), signal },
  ).then((response) => response.draft);
}

export function discardTicketConversationDraft(
  organizationId: number | string,
  ticketId: number | string,
  draftId: string,
  etag: string,
  signal?: AbortSignal,
) {
  return requestJson<{ ok: boolean; discarded: boolean }>(
    `${ticketConversationPath(organizationId, ticketId)}/drafts/${pathSegment(draftId)}`,
    { method: "DELETE", headers: { "If-Match": etag }, signal },
  );
}

export function sendTicketConversationMessage(
  organizationId: number | string,
  ticketId: number | string,
  payload: {
    kind: TicketConversationKind;
    body: string;
    attachmentIds?: Array<number | string>;
    draftId?: string;
    draftVersion?: number;
  },
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return requestJson<{ ok: boolean; message: TicketConversationMessage }>(
    `${ticketConversationPath(organizationId, ticketId)}/messages`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
      signal,
    },
  ).then((response) => response.message);
}

export function editTicketConversationMessage(
  organizationId: number | string,
  ticketId: number | string,
  messageId: string,
  payload: { body: string; reason: string },
  etag: string,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return requestJson<{ ok: boolean; message: TicketConversationMessage }>(
    `${ticketConversationPath(organizationId, ticketId)}/messages/${pathSegment(messageId)}`,
    {
      method: "PATCH",
      headers: { "If-Match": etag, "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
      signal,
    },
  ).then((response) => response.message);
}

export function listTicketConversationRevisions(
  organizationId: number | string,
  ticketId: number | string,
  messageId: string,
  signal?: AbortSignal,
) {
  return requestJson<{ ok: boolean; revisions: TicketConversationRevision[] }>(
    `${ticketConversationPath(organizationId, ticketId)}/messages/${pathSegment(messageId)}/revisions`,
    { signal },
  ).then((response) => response.revisions);
}

export async function updateTicket(
  organizationId: number | string,
  ticketId: number | string,
  payload: UpdateTicketPayload,
  signal?: AbortSignal,
  options: { etag?: string } = {},
) {
  const response = await requestJson<{ ok: boolean; ticket: Ticket }>(
    `${ticketsPath(organizationId)}/${pathSegment(ticketId)}`,
    {
      method: "PATCH",
      headers: options.etag ? { "If-Match": options.etag } : undefined,
      body: JSON.stringify(payload),
      signal,
    },
  );
  return validatedTicketResponse(response.ticket, organizationId, ticketId, Boolean(options.etag));
}

export async function runTicketCommand(
  organizationId: number | string,
  ticketId: number | string,
  command: TicketCommand,
  etag: string,
  signal?: AbortSignal,
) {
  const suffix = command.kind === "transition" ? "transitions" : command.kind === "wait" ? "waits" : "reopen";
  const response = await requestJson<{ ok: boolean; ticket: Ticket }>(
    `${ticketsPath(organizationId)}/${pathSegment(ticketId)}/${suffix}`,
    { method: "POST", headers: { "If-Match": etag }, body: JSON.stringify(command.payload), signal },
  );
  return validatedTicketResponse(response.ticket, organizationId, ticketId, true);
}

type UploadStartResponse = {
  ok: boolean;
  attachment: TicketAttachment;
  upload: {
    attachmentId: number | string;
    sessionId?: string;
    offset: number;
    chunkSize: number;
    size: number;
    etag?: string;
    expiresAt?: string;
    resumable?: boolean;
  };
};

type UploadChunkResponse = {
  ok: boolean;
  attachment: TicketAttachment | null;
  session?: TicketAttachmentUploadSession;
  offset?: number;
  complete: boolean;
};

type UploadHead = {
  offset: number;
  size: number;
  etag: string;
  expiresAt: string | null;
};

const DROPBOX_HASH_BLOCK_BYTES = 4 * 1024 * 1024;

function attachmentsPath(
  organizationId: number | string,
  ticketId: number | string,
) {
  return `${ticketsPath(organizationId)}/${pathSegment(ticketId)}/attachments`;
}

function attachmentUploadPath(
  organizationId: number | string,
  ticketId: number | string,
  sessionId?: string,
) {
  const base = `${attachmentsPath(organizationId, ticketId)}/uploads`;
  return sessionId ? `${base}/${pathSegment(sessionId)}` : base;
}

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Upload cancelado.", "AbortError");
}

async function digestSha256(bytes: ArrayBuffer) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function dropboxContentHashFile(file: File, signal?: AbortSignal) {
  const digests: Uint8Array[] = [];
  for (let offset = 0; offset < file.size; offset += DROPBOX_HASH_BLOCK_BYTES) {
    abortIfNeeded(signal);
    const end = Math.min(file.size, offset + DROPBOX_HASH_BLOCK_BYTES);
    digests.push(await digestSha256(await file.slice(offset, end).arrayBuffer()));
  }
  const joined = new Uint8Array(digests.length * 32);
  digests.forEach((digest, index) => joined.set(digest, index * 32));
  return bytesToHex(await digestSha256(joined.buffer));
}

export async function listTicketAttachmentUploadSessions(
  organizationId: number | string,
  ticketId: number | string,
  signal?: AbortSignal,
) {
  const response = await requestJson<{ ok: boolean; sessions: TicketAttachmentUploadSession[] }>(
    attachmentUploadPath(organizationId, ticketId),
    { signal },
  );
  return Array.isArray(response.sessions) ? response.sessions : [];
}

export async function headTicketAttachmentUpload(
  organizationId: number | string,
  ticketId: number | string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<UploadHead> {
  const response = await fetch(attachmentUploadPath(organizationId, ticketId, sessionId), {
    method: "HEAD",
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw await responseError(response);
  const offset = Number(response.headers.get("Upload-Offset"));
  const size = Number(response.headers.get("Upload-Length"));
  const etag = String(response.headers.get("ETag") || "").trim();
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(size) || size <= 0 || !etag) {
    throw toTicketApiError(buildClientApiError({ status: 502, code: "ATTACHMENT_UPLOAD_HEAD_INVALID", category: "INFRASTRUCTURE", retryable: true }));
  }
  return { offset, size, etag, expiresAt: response.headers.get("Upload-Expires") };
}

function uploadAttachmentChunk(
  url: string,
  chunk: Blob,
  offset: number,
  totalSize: number,
  etag: string | null,
  options: UploadOptions,
) {
  return new Promise<UploadChunkResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => options.signal?.removeEventListener("abort", abort);

    xhr.open("PATCH", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("Upload-Offset", String(offset));
    if (etag) xhr.setRequestHeader("If-Match", etag);

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      options.onPhase?.("uploading");
      options.onProgress?.(
        Math.max(0, Math.min(99, Math.round(((offset + event.loaded) / totalSize) * 100))),
      );
    });
    xhr.upload.addEventListener("load", () => {
      if (offset + chunk.size >= totalSize) options.onPhase?.("finalizing");
    });
    xhr.addEventListener("load", () => {
      cleanup();
      let payload: Partial<UploadChunkResponse> & { error?: unknown; code?: string } = {};
      try { payload = JSON.parse(xhr.responseText || "{}"); } catch { /* handled below */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as UploadChunkResponse);
        return;
      }
      reject(toTicketApiError(buildHttpApiError(xhr.status, payload, {}, getXhrErrorReference(xhr))));
    });
    xhr.addEventListener("error", () => {
      cleanup();
      reject(toTicketApiError(buildClientApiError({ status: 0, code: "ATTACHMENT_UPLOAD_NETWORK_ERROR", category: "INFRASTRUCTURE", retryable: true })));
    });
    xhr.addEventListener("abort", () => {
      cleanup();
      reject(new DOMException("Upload cancelado.", "AbortError"));
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    xhr.send(chunk);
  });
}

async function reconcileAfterChunkFailure(
  organizationId: number | string,
  ticketId: number | string,
  sessionId: string,
  previousOffset: number,
  expectedEnd: number,
  signal?: AbortSignal,
) {
  const head = await headTicketAttachmentUpload(organizationId, ticketId, sessionId, signal);
  if (head.offset >= expectedEnd) return { accepted: true, head };
  if (head.offset === previousOffset) return { accepted: false, head };
  throw toTicketApiError(buildClientApiError({ status: 409, code: "ATTACHMENT_UPLOAD_OFFSET_DIVERGED", category: "CONFLICT", retryable: false }));
}

async function continueResumableUpload(
  organizationId: number | string,
  ticketId: number | string,
  sessionId: string,
  file: File,
  initialOffset: number,
  initialEtag: string,
  chunkSize: number,
  options: UploadOptions,
) {
  const url = attachmentUploadPath(organizationId, ticketId, sessionId);
  let offset = initialOffset;
  let etag = initialEtag;

  while (offset < file.size) {
    abortIfNeeded(options.signal);
    const end = Math.min(file.size, offset + chunkSize);
    const chunk = file.slice(offset, end);
    let response: UploadChunkResponse | null = null;
    try {
      response = await uploadAttachmentChunk(url, chunk, offset, file.size, etag, options);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      options.onPhase?.("resuming");
      const reconciliation = await reconcileAfterChunkFailure(
        organizationId, ticketId, sessionId, offset, end, options.signal,
      );
      offset = reconciliation.head.offset;
      etag = reconciliation.head.etag;
      if (reconciliation.accepted) continue;
      // Provider did not acknowledge the chunk; one bounded retry with the
      // freshly observed server ETag/offset is safe. A response-lost write will
      // be reconciled by the server through Dropbox correct_offset.
      response = await uploadAttachmentChunk(url, chunk, offset, file.size, etag, options);
    }

    const nextOffset = Number(response?.session?.offset ?? response?.offset);
    if (!Number.isInteger(nextOffset) || nextOffset <= offset) {
      throw toTicketApiError(buildClientApiError({ status: 502, code: "ATTACHMENT_UPLOAD_PROGRESS_INVALID", category: "INFRASTRUCTURE", retryable: true }));
    }
    offset = nextOffset;
    etag = String(response?.session?.etag || etag);
    if (response?.complete) {
      if (!response.attachment) throw new Error("O servidor concluiu o envio sem retornar o anexo.");
      options.onProgress?.(100);
      return response.attachment;
    }
  }
  throw new Error("O upload terminou sem confirmação do anexo.");
}

export async function resumeTicketAttachmentUpload(
  organizationId: number | string,
  ticketId: number | string,
  session: TicketAttachmentUploadSession,
  file: File,
  options: UploadOptions = {},
) {
  abortIfNeeded(options.signal);
  if (file.size !== session.size) {
    throw toTicketApiError(buildClientApiError({ status: 409, code: "ATTACHMENT_UPLOAD_FILE_MISMATCH", category: "CONFLICT", retryable: false }));
  }
  options.onPhase?.("hashing");
  const hash = await dropboxContentHashFile(file, options.signal);
  if (hash !== session.expectedContentHash) {
    throw toTicketApiError(buildClientApiError({ status: 409, code: "ATTACHMENT_UPLOAD_FILE_MISMATCH", category: "CONFLICT", retryable: false }));
  }
  options.onPhase?.("resuming");
  const head = await headTicketAttachmentUpload(organizationId, ticketId, session.id, options.signal);
  if (head.size !== file.size) {
    throw toTicketApiError(buildClientApiError({ status: 409, code: "ATTACHMENT_UPLOAD_FILE_MISMATCH", category: "CONFLICT", retryable: false }));
  }
  return continueResumableUpload(
    organizationId, ticketId, session.id, file, head.offset, head.etag,
    Math.max(1, Math.min(8 * 1024 * 1024, file.size || 1)), options,
  );
}

export async function cancelTicketAttachmentUpload(
  organizationId: number | string,
  ticketId: number | string,
  sessionId: string,
  signal?: AbortSignal,
) {
  return requestJson<{ ok: boolean; cancelled: boolean }>(
    attachmentUploadPath(organizationId, ticketId, sessionId),
    { method: "DELETE", signal },
  );
}

export async function uploadTicketAttachment(
  organizationId: number | string,
  ticketId: number | string,
  file: File,
  options: UploadOptions = {},
) {
  abortIfNeeded(options.signal);
  options.onPhase?.("hashing");
  const contentHash = await dropboxContentHashFile(file, options.signal);
  const basePath = attachmentsPath(organizationId, ticketId);
  const started = await requestJson<UploadStartResponse>(basePath, {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      contentHash,
      ...(options.draftId ? { draftId: options.draftId } : {}),
    }),
    signal: options.signal,
  });
  const attachmentId = started.upload.attachmentId;
  const chunkSize = Math.max(1, started.upload.chunkSize);
  let offset = started.upload.offset;

  if (started.upload.resumable && started.upload.sessionId && started.upload.etag) {
    options.onPhase?.("uploading");
    return continueResumableUpload(
      organizationId, ticketId, started.upload.sessionId, file, offset,
      started.upload.etag, chunkSize, options,
    );
  }

  // Legacy path remains available while CC-06 flag is OFF.
  try {
    while (offset < file.size) {
      const end = Math.min(file.size, offset + chunkSize);
      options.onPhase?.("uploading");
      const response = await uploadAttachmentChunk(
        `${basePath}/${pathSegment(attachmentId)}`,
        file.slice(offset, end),
        offset,
        file.size,
        null,
        options,
      );
      const legacyOffset = Number(response.offset);
      if (!Number.isInteger(legacyOffset) || legacyOffset <= offset) {
        throw new Error("O servidor não confirmou o avanço do upload.");
      }
      offset = legacyOffset;
      if (response.complete) {
        if (!response.attachment) throw new Error("O servidor concluiu o envio sem retornar o anexo.");
        options.onProgress?.(100);
        return response.attachment;
      }
    }
    throw new Error("O upload terminou sem confirmação do anexo.");
  } catch (error) {
    void fetch(`${basePath}/${pathSegment(attachmentId)}`, {
      method: "DELETE",
      credentials: "include",
      headers: { Accept: "application/json" },
      keepalive: true,
    }).catch(() => undefined);
    throw error;
  }
}

function downloadFileName(response: Response, fallback: string) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const simpleMatch = disposition.match(/filename="?([^";]+)"?/i);

  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return fallback;
    }
  }

  return simpleMatch?.[1] || fallback;
}

export async function downloadTicketAttachment(
  organizationId: number | string,
  ticketId: number | string,
  attachment: TicketAttachment,
) {
  const response = await fetch(
    `${ticketsPath(organizationId)}/${pathSegment(ticketId)}/attachments/${pathSegment(attachment.id)}/download`,
    {
      credentials: "include",
      headers: { Accept: "*/*" },
    },
  );

  if (!response.ok) throw await responseError(response);

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = downloadFileName(response, attachment.name);
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function deleteTicketAttachment(
  organizationId: number | string,
  ticketId: number | string,
  attachmentId: number | string,
) {
  return requestJson<{ ok: boolean; deleted: boolean }>(
    `${ticketsPath(organizationId)}/${pathSegment(ticketId)}/attachments/${pathSegment(attachmentId)}`,
    { method: "DELETE" },
  );
}
