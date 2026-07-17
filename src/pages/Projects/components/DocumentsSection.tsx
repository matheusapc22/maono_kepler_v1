import { useEffect, useMemo, useRef, useState } from "react";

import { can, type AccessControlUser } from "../../../access-control/can";
import { PERMISSION } from "../../../access-control/permissions";
import {
  deleteOrganizationFile,
  downloadOrganizationFile,
  listOrganizationFiles,
  uploadOrganizationFile,
  type OrganizationFile,
} from "../../../lib/api";

type DocumentsSectionProps = {
  user?: AccessControlUser | null;
  organizationId?: number | string | null;
};

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  "geojson",
  "json",
  "csv",
  "xlsx",
  "xls",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "zip",
  "txt",
  "docx",
]);

function formatBytes(size?: number) {
  if (!size || size <= 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fileExtension(fileName: string) {
  return fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
}

function validateFile(file: File) {
  if (file.size <= 0) return "O arquivo selecionado está vazio.";
  if (file.size > MAX_FILE_BYTES) return "O arquivo excede o limite de 50 MB.";

  const extension = fileExtension(file.name);
  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
    return "Tipo de arquivo não permitido. Use GeoJSON, JSON, CSV, planilha, PDF, imagem, ZIP, TXT ou DOCX.";
  }

  return null;
}

function formatRequestError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;

  const enriched = error as Error & {
    code?: string;
    payload?: unknown;
  };
  const payload =
    enriched.payload && typeof enriched.payload === "object"
      ? (enriched.payload as {
          code?: unknown;
          stage?: unknown;
          requestId?: unknown;
        })
      : null;

  const code =
    typeof payload?.code === "string" ? payload.code : enriched.code || null;
  const stage = typeof payload?.stage === "string" ? payload.stage : null;
  const requestId =
    typeof payload?.requestId === "string" ? payload.requestId : null;
  const diagnostics = [
    code ? `código ${code}` : null,
    stage ? `etapa ${stage}` : null,
    requestId ? `requisição ${requestId}` : null,
  ].filter(Boolean);

  return diagnostics.length
    ? `${error.message} (${diagnostics.join(" · ")})`
    : error.message || fallback;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function DocumentsSection({
  user,
  organizationId,
}: DocumentsSectionProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<OrganizationFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyFileId, setBusyFileId] = useState<number | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const permissionContext = useMemo(
    () => ({
      organizationId: organizationId ?? undefined,
      organization: organizationId ? { id: organizationId } : undefined,
    }),
    [organizationId],
  );

  const canView = can(user, PERMISSION.DOCUMENT_VIEW, permissionContext);
  const canUpload = can(user, PERMISSION.DOCUMENT_UPLOAD, permissionContext);
  const canDownload = can(user, PERMISSION.DOCUMENT_DOWNLOAD, permissionContext);
  const canDelete = can(user, PERMISSION.DOCUMENT_DELETE, permissionContext);

  async function loadFiles() {
    if (!organizationId || !canView) {
      setFiles([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await listOrganizationFiles(organizationId);
      setFiles(response.files ?? []);
    } catch (requestError) {
      setError(
        formatRequestError(
          requestError,
          "Não foi possível carregar os documentos.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setMessage(null);
    void loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, canView]);

  async function handleUpload(file: File) {
    if (!organizationId || !canUpload) return;

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("idempotencyKey", crypto.randomUUID());

    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      await uploadOrganizationFile(organizationId, formData);
      await loadFiles();
      setMessage("Arquivo enviado e catalogado com sucesso.");

      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (requestError) {
      setError(
        formatRequestError(
          requestError,
          "Não foi possível enviar o documento.",
        ),
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(file: OrganizationFile) {
    if (!organizationId || !canDownload) return;

    setBusyFileId(file.id);
    setError(null);
    setMessage(null);

    try {
      const response = await downloadOrganizationFile(organizationId, file.id);
      downloadBlob(response.blob, response.fileName || file.name || "documento");
    } catch (requestError) {
      setError(
        formatRequestError(
          requestError,
          "Não foi possível baixar o documento.",
        ),
      );
    } finally {
      setBusyFileId(null);
    }
  }

  async function handleDelete(file: OrganizationFile) {
    if (!organizationId || !canDelete) return;

    const confirmed = window.confirm(
      `Excluir o documento "${file.name}"? Essa ação não pode ser desfeita.`,
    );
    if (!confirmed) return;

    setBusyFileId(file.id);
    setError(null);
    setMessage(null);

    try {
      await deleteOrganizationFile(organizationId, file.id);
      await loadFiles();
      setMessage("Arquivo excluído do Dropbox e removido da listagem.");
    } catch (requestError) {
      setError(
        formatRequestError(
          requestError,
          "Não foi possível excluir o documento.",
        ),
      );
    } finally {
      setBusyFileId(null);
    }
  }

  if (!organizationId) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Arquivos e Documentos</h2>
        <p>Selecione uma organização para consultar documentos.</p>
      </section>
    );
  }

  if (!canView) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Arquivos e Documentos</h2>
        <p>Você não tem permissão para visualizar documentos desta organização.</p>
      </section>
    );
  }

  return (
    <section className="mm-card mm-section-card">
      <div className="projects-section-header">
        <div>
          <h2>Arquivos e Documentos</h2>
          <p>
            Os arquivos são armazenados dentro da pasta Dropbox da organização.
            Metadados, permissões e auditoria permanecem no Cloudflare D1.
          </p>
        </div>

        {canUpload ? (
          <label className="mm-button secondary">
            {uploading ? "Enviando..." : "Enviar documento"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".geojson,.json,.csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.zip,.txt,.docx"
              disabled={uploading}
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
          </label>
        ) : null}
      </div>

      {error ? <p className="mm-error-text">{error}</p> : null}
      {message ? <p className="mm-success-text">{message}</p> : null}

      {loading ? (
        <p>Carregando documentos...</p>
      ) : files.length === 0 ? (
        <div className="projects-empty-state">
          Nenhum documento encontrado para esta organização.
        </div>
      ) : (
        <div className="mm-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Tipo</th>
                <th>Tamanho</th>
                <th>Atualizado em</th>
                <th>Ações</th>
              </tr>
            </thead>

            <tbody>
              {files.map((file) => {
                const busy = String(busyFileId) === String(file.id);

                return (
                  <tr key={file.id}>
                    <td>{file.name}</td>
                    <td>{file.mimeType || "—"}</td>
                    <td>{formatBytes(file.size)}</td>
                    <td>{formatDate(file.updatedAt || file.createdAt)}</td>
                    <td>
                      <div className="projects-row-actions">
                        {canDownload ? (
                          <button
                            type="button"
                            className="mm-button ghost"
                            disabled={busy}
                            onClick={() => void handleDownload(file)}
                          >
                            {busy ? "Processando..." : "Baixar"}
                          </button>
                        ) : null}

                        {canDelete ? (
                          <button
                            type="button"
                            className="mm-button danger"
                            disabled={busy}
                            onClick={() => void handleDelete(file)}
                          >
                            Excluir
                          </button>
                        ) : null}

                        {!canDownload && !canDelete ? "—" : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
