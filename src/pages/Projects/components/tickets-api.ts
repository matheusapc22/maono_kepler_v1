import type {
  CreateTicketPayload,
  Ticket,
  TicketAttachment,
  TicketDetailResponse,
  TicketFilters,
  TicketListResponse,
  UpdateTicketPayload,
} from "./ticket-types";

type RequestOptions = RequestInit & {
  signal?: AbortSignal;
};

type UploadOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  onStage?: (stage: "uploading" | "finalizing") => void;
};

export class TicketApiError extends Error {
  status?: number;
  code?: string;
  requestId?: string;
  stage?: string;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      requestId?: string;
      stage?: string;
    } = {},
  ) {
    super(message);
    this.name = "TicketApiError";
    Object.assign(this, options);
  }
}

export function toTicketApiError(
  error: unknown,
  fallback = "Não foi possível concluir a operação.",
) {
  if (error instanceof TicketApiError) return error;
  if (error instanceof Error) return new TicketApiError(error.message);
  return new TicketApiError(fallback);
}

function pathSegment(value: number | string) {
  return encodeURIComponent(String(value));
}

function ticketsPath(organizationId: number | string) {
  return `/api/organizations/${pathSegment(organizationId)}/tickets`;
}

async function responseError(response: Response) {
  let message = `A requisição falhou (${response.status}).`;
  let code: string | undefined;
  let requestId = response.headers.get("X-Request-Id") || undefined;
  let stage: string | undefined;

  try {
    const payload = await response.json();
    if (typeof payload?.error === "string") message = payload.error;
    else if (typeof payload?.error?.message === "string") {
      message = payload.error.message;
    }
    code = payload?.code || payload?.error?.code;
    requestId = payload?.requestId || requestId;
    stage = payload?.stage;
  } catch {
    // Mantém a mensagem HTTP segura.
  }

  return new TicketApiError(message, {
    status: response.status,
    code,
    requestId,
    stage,
  });
}

async function requestJson<T>(url: string, options: RequestOptions = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) throw await responseError(response);
  return (await response.json()) as T;
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

export async function createTicket(
  organizationId: number | string,
  payload: CreateTicketPayload,
  signal?: AbortSignal,
) {
  const response = await requestJson<{ ok: boolean; ticket: Ticket }>(
    ticketsPath(organizationId),
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    },
  );
  return response.ticket;
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

export async function updateTicket(
  organizationId: number | string,
  ticketId: number | string,
  payload: UpdateTicketPayload,
  signal?: AbortSignal,
) {
  const response = await requestJson<{ ok: boolean; ticket: Ticket }>(
    `${ticketsPath(organizationId)}/${pathSegment(ticketId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
      signal,
    },
  );
  return response.ticket;
}

type UploadStartResponse = {
  ok: boolean;
  attachment: TicketAttachment;
  upload: {
    attachmentId: number | string;
    offset: number;
    chunkSize: number;
    size: number;
  };
};

type UploadChunkResponse = {
  ok: boolean;
  attachment: TicketAttachment | null;
  offset: number;
  complete: boolean;
};

function attachmentsPath(
  organizationId: number | string,
  ticketId: number | string,
) {
  return `${ticketsPath(organizationId)}/${pathSegment(ticketId)}/attachments`;
}

function uploadAttachmentChunk(
  url: string,
  chunk: Blob,
  offset: number,
  totalSize: number,
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

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      options.onStage?.("uploading");
      options.onProgress?.(
        Math.max(
          0,
          Math.min(
            99,
            Math.round(((offset + event.loaded) / totalSize) * 100),
          ),
        ),
      );
    });

    xhr.upload.addEventListener("load", () => {
      if (offset + chunk.size >= totalSize) {
        options.onStage?.("finalizing");
      }
    });

    xhr.addEventListener("load", () => {
      cleanup();
      let payload: Partial<UploadChunkResponse> & {
        error?: string | { message?: string };
        code?: string;
        requestId?: string;
        stage?: string;
      } = {};
      try {
        payload = JSON.parse(xhr.responseText || "{}");
      } catch {
        // A mensagem abaixo é suficiente para respostas não JSON.
      }

      if (
        xhr.status >= 200 &&
        xhr.status < 300 &&
        typeof payload.offset === "number"
      ) {
        resolve(payload as UploadChunkResponse);
        return;
      }

      const message =
        typeof payload.error === "string"
          ? payload.error
          : payload.error?.message ||
            "Não foi possível enviar uma parte do arquivo.";
      const requestId =
        payload.requestId || xhr.getResponseHeader("X-Request-Id") || undefined;
      reject(
        new TicketApiError(message, {
          status: xhr.status,
          code: payload.code,
          requestId,
          stage: payload.stage,
        }),
      );
    });

    xhr.addEventListener("error", () => {
      cleanup();
      reject(
        new TicketApiError("Falha de rede durante o envio do arquivo.", {
          code: "TICKET_UPLOAD_NETWORK_ERROR",
          stage: "attachment.chunk",
        }),
      );
    });

    xhr.addEventListener("abort", () => {
      cleanup();
      reject(new DOMException("Upload cancelado.", "AbortError"));
    });

    options.signal?.addEventListener("abort", abort, { once: true });

    xhr.send(chunk);
  });
}

export async function uploadTicketAttachment(
  organizationId: number | string,
  ticketId: number | string,
  file: File,
  options: UploadOptions = {},
) {
  if (options.signal?.aborted) {
    throw new DOMException("Upload cancelado.", "AbortError");
  }

  const basePath = attachmentsPath(organizationId, ticketId);
  const started = await requestJson<UploadStartResponse>(basePath, {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    }),
    signal: options.signal,
  });
  const attachmentId = started.upload.attachmentId;
  const chunkSize = Math.max(1, started.upload.chunkSize);
  let offset = started.upload.offset;

  try {
    while (offset < file.size) {
      const end = Math.min(file.size, offset + chunkSize);
      options.onStage?.("uploading");
      const response = await uploadAttachmentChunk(
        `${basePath}/${pathSegment(attachmentId)}`,
        file.slice(offset, end),
        offset,
        file.size,
        options,
      );

      if (response.offset <= offset) {
        throw new Error("O servidor não confirmou o avanço do upload.");
      }
      offset = response.offset;

      if (response.complete) {
        if (!response.attachment) {
          throw new Error("O servidor concluiu o envio sem retornar o anexo.");
        }
        options.onProgress?.(100);
        return response.attachment;
      }
    }

    throw new Error("O upload terminou antes da confirmação do servidor.");
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
