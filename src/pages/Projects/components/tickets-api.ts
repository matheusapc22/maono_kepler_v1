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
};

function pathSegment(value: number | string) {
  return encodeURIComponent(String(value));
}

function ticketsPath(organizationId: number | string) {
  return `/api/organizations/${pathSegment(organizationId)}/tickets`;
}

async function responseError(response: Response) {
  let message = `A requisição falhou (${response.status}).`;
  let code: string | undefined;

  try {
    const payload = await response.json();
    if (typeof payload?.error === "string") message = payload.error;
    else if (typeof payload?.error?.message === "string") {
      message = payload.error.message;
    }
    code = payload?.code || payload?.error?.code;
  } catch {
    // Mantém a mensagem HTTP segura.
  }

  const error = new Error(message) as Error & {
    status?: number;
    code?: string;
  };
  error.status = response.status;
  error.code = code;
  return error;
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

export function uploadTicketAttachment(
  organizationId: number | string,
  ticketId: number | string,
  file: File,
  options: UploadOptions = {},
) {
  return new Promise<TicketAttachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${ticketsPath(organizationId)}/${pathSegment(ticketId)}/attachments`;
    const formData = new FormData();
    formData.set("file", file);

    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      options.onProgress?.(
        Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))),
      );
    });

    xhr.addEventListener("load", () => {
      let payload: {
        attachment?: TicketAttachment;
        error?: string | { message?: string };
        code?: string;
      } = {};
      try {
        payload = JSON.parse(xhr.responseText || "{}");
      } catch {
        // A mensagem abaixo é suficiente para respostas não JSON.
      }

      if (xhr.status >= 200 && xhr.status < 300 && payload.attachment) {
        options.onProgress?.(100);
        resolve(payload.attachment);
        return;
      }

      const message =
        typeof payload.error === "string"
          ? payload.error
          : payload.error?.message ||
            `Não foi possível enviar ${file.name}.`;
      const error = new Error(message) as Error & {
        status?: number;
        code?: string;
      };
      error.status = xhr.status;
      error.code = payload.code;
      reject(error);
    });

    xhr.addEventListener("error", () => {
      reject(new Error(`Falha de rede ao enviar ${file.name}.`));
    });

    xhr.addEventListener("abort", () => {
      reject(new DOMException("Upload cancelado.", "AbortError"));
    });

    options.signal?.addEventListener("abort", () => xhr.abort(), {
      once: true,
    });

    xhr.send(formData);
  });
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
