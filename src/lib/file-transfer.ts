import type { OrganizationFile } from "./api";
import {
  buildClientApiError,
  buildHttpApiError,
} from "./api-transport";
import { getXhrErrorReference } from "./error-contract";

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
    return null;
  }
}

function buildTransferHttpError(xhr: XMLHttpRequest, payload: unknown) {
  return buildHttpApiError(
    xhr.status,
    payload,
    {},
    getXhrErrorReference(xhr),
  );
}

function buildTransferNetworkError() {
  return buildClientApiError({
    status: 503,
    code: "INFRASTRUCTURE_NETWORK_FAILURE",
    category: "INFRASTRUCTURE",
    retryable: true,
  });
}

function buildTransferAbortError(
  code: "DOCUMENT_UPLOAD_ABORTED" | "DOCUMENT_DOWNLOAD_ABORTED",
) {
  return buildClientApiError({
    status: 0,
    code,
    category: "STORAGE",
    retryable: false,
  });
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
      reject(buildTransferNetworkError());
    };

    xhr.onabort = () => {
      reject(buildTransferAbortError("DOCUMENT_UPLOAD_ABORTED"));
    };

    xhr.onload = () => {
      const payload = parseJsonSafely(xhr.responseText || "");

      if (xhr.status >= 200 && xhr.status < 300) {
        if (payload && typeof payload === "object") {
          resolve(payload as OrganizationFileUploadResponse);
          return;
        }

        reject(
          buildHttpApiError(
            502,
            payload,
            {
              status: 502,
              code: "INFRASTRUCTURE_UNEXPECTED_ERROR",
              category: "INFRASTRUCTURE",
              retryable: true,
            },
            getXhrErrorReference(xhr),
          ),
        );
        return;
      }

      reject(buildTransferHttpError(xhr, payload));
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
      reject(buildTransferNetworkError());
    };

    xhr.onabort = () => {
      reject(buildTransferAbortError("DOCUMENT_DOWNLOAD_ABORTED"));
    };

    xhr.onload = async () => {
      const responseBlob =
        xhr.response instanceof Blob ? xhr.response : new Blob();

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
      reject(buildTransferHttpError(xhr, payload));
    };

    xhr.send();
  });
}
