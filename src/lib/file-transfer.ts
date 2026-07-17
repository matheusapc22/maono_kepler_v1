import type { OrganizationFile } from "./api";

export type FileTransferProgress = {
  loaded: number;
  total: number | null;
  percent: number | null;
};

export type OrganizationFileUploadResponse = {
  ok: boolean;
  file: OrganizationFile;
  requestId?: string;
};

export type FileDownloadResponse = {
  blob: Blob;
  fileName: string | null;
  contentType: string | null;
};

type ApiErrorPayload = {
  error?: unknown;
  message?: unknown;
  code?: unknown;
};

class FileTransferError extends Error {
  status: number;
  code?: string;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown, code?: string) {
    super(message);
    this.name = "FileTransferError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

function pathSegment(value: number | string): string {
  return encodeURIComponent(String(value));
}

function organizationFilesPath(organizationId: number | string): string {
  return `/api/organizations/${pathSegment(organizationId)}/files`;
}

function parseJsonSafely(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getErrorMessage(payload: unknown, status: number): string {
  if (typeof payload === "string" && payload.trim()) return payload;

  if (payload && typeof payload === "object") {
    const data = payload as ApiErrorPayload;

    if (typeof data.error === "string" && data.error.trim()) {
      return data.error;
    }

    if (
      data.error &&
      typeof data.error === "object" &&
      "message" in data.error &&
      typeof (data.error as { message?: unknown }).message === "string"
    ) {
      return (data.error as { message: string }).message;
    }

    if (typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }
  }

  return `Erro HTTP ${status}`;
}

function getErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;

  const data = payload as ApiErrorPayload;

  if (typeof data.code === "string" && data.code.trim()) {
    return data.code;
  }

  if (
    data.error &&
    typeof data.error === "object" &&
    "code" in data.error &&
    typeof (data.error as { code?: unknown }).code === "string"
  ) {
    return (data.error as { code: string }).code;
  }

  return undefined;
}

function getFileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].replace(/"/g, ""));
  }

  const simpleMatch = header.match(/filename="?([^";]+)"?/i);
  return simpleMatch?.[1] || null;
}

function progressFromEvent(event: ProgressEvent<EventTarget>): FileTransferProgress {
  const total = event.lengthComputable && event.total > 0 ? event.total : null;

  return {
    loaded: event.loaded,
    total,
    percent: total ? Math.min(100, Math.round((event.loaded / total) * 100)) : null,
  };
}

export function uploadOrganizationFileWithProgress(
  organizationId: number | string,
  formData: FormData,
  onProgress?: (progress: FileTransferProgress) => void,
): Promise<OrganizationFileUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", organizationFilesPath(organizationId));
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");

    xhr.upload.onprogress = (event) => {
      onProgress?.(progressFromEvent(event));
    };

    xhr.upload.onload = () => {
      onProgress?.({ loaded: 1, total: 1, percent: 100 });
    };

    xhr.onerror = () => {
      reject(
        new FileTransferError(
          "Falha de rede durante o envio do documento.",
          0,
          { code: "UPLOAD_NETWORK_ERROR", stage: "file.upload" },
          "UPLOAD_NETWORK_ERROR",
        ),
      );
    };

    xhr.onabort = () => {
      reject(
        new FileTransferError(
          "O envio do documento foi cancelado.",
          0,
          { code: "UPLOAD_ABORTED", stage: "file.upload" },
          "UPLOAD_ABORTED",
        ),
      );
    };

    xhr.onload = () => {
      const payload = parseJsonSafely(xhr.responseText || "");

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as OrganizationFileUploadResponse);
        return;
      }

      reject(
        new FileTransferError(
          getErrorMessage(payload, xhr.status),
          xhr.status,
          payload,
          getErrorCode(payload),
        ),
      );
    };

    xhr.send(formData);
  });
}

export function downloadOrganizationFileWithProgress(
  organizationId: number | string,
  fileId: number | string,
  onProgress?: (progress: FileTransferProgress) => void,
): Promise<FileDownloadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open(
      "GET",
      `${organizationFilesPath(organizationId)}/${pathSegment(fileId)}/download`,
    );
    xhr.withCredentials = true;
    xhr.responseType = "blob";

    xhr.onprogress = (event) => {
      onProgress?.(progressFromEvent(event));
    };

    xhr.onerror = () => {
      reject(
        new FileTransferError(
          "Falha de rede durante o download do documento.",
          0,
          { code: "DOWNLOAD_NETWORK_ERROR", stage: "file.download" },
          "DOWNLOAD_NETWORK_ERROR",
        ),
      );
    };

    xhr.onabort = () => {
      reject(
        new FileTransferError(
          "O download do documento foi cancelado.",
          0,
          { code: "DOWNLOAD_ABORTED", stage: "file.download" },
          "DOWNLOAD_ABORTED",
        ),
      );
    };

    xhr.onload = async () => {
      const responseBlob = xhr.response instanceof Blob ? xhr.response : new Blob();

      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.({
          loaded: responseBlob.size,
          total: responseBlob.size || null,
          percent: 100,
        });

        resolve({
          blob: responseBlob,
          fileName: getFileNameFromContentDisposition(
            xhr.getResponseHeader("Content-Disposition"),
          ),
          contentType: xhr.getResponseHeader("Content-Type"),
        });
        return;
      }

      const payload = parseJsonSafely(await responseBlob.text());
      reject(
        new FileTransferError(
          getErrorMessage(payload, xhr.status),
          xhr.status,
          payload,
          getErrorCode(payload),
        ),
      );
    };

    xhr.send();
  });
}
