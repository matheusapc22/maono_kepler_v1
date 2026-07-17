import { useEffect, useMemo, useRef, useState } from "react";

import { can, type AccessControlUser } from "../../../access-control/can";
import { PERMISSION } from "../../../access-control/permissions";
import {
  deleteOrganizationFile,
  listOrganizationFiles,
  type OrganizationFile,
} from "../../../lib/api";
import {
  downloadOrganizationFileWithProgress,
  uploadOrganizationFileWithProgress,
  type FileTransferProgress,
} from "../../../lib/file-transfer";

import "./DocumentsTransferPanel.css";

type DocumentsSectionProps = {
  user?: AccessControlUser | null;
  organizationId?: number | string | null;
};

type TransferKind = "upload" | "download";
type TransferStatus = "running" | "processing" | "success" | "error";

type TransferPanelState = {
  kind: TransferKind;
  status: TransferStatus;
  fileName: string;
  percent: number;
  detail: string;
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

function formatBytes(size?: number | null) {
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

function transferTitle(transfer: TransferPanelState) {
  if (transfer.status === "success") {
    return transfer.kind === "upload" ? "Upload concluído" : "Download concluído";
  }

  if (transfer.status === "error") {
    return transfer.kind === "upload" ? "Falha no upload" : "Falha no download";
  }

  if (transfer.status === "processing") return "Processando documento";
  return transfer.kind === "upload" ? "Enviando documento" : "Baixando documento";
}

function TransferPanel({
  transfer,
  onClose,
}: {
  transfer: TransferPanelState;
  onClose: () => void;
}) {
  const canClose = transfer.status === "success" || transfer.status === "error";

  return (
    <aside
      className={`mm-transfer-panel ${transfer.status}`}
      role={transfer.status === "error" ? "alert" : "status"}
      aria-live="polite"
      aria-label={transferTitle(transfer)}
    >
      <div className="mm-transfer-panel-header">
        <div className="mm-transfer-panel-icon" aria-hidden="true">
          {transfer.kind === "upload" ? "↑" : "↓"}
        </div>

        <div className="mm-transfer-panel-copy">
          <strong>{transferTitle(transfer)}</strong>
          <span title={transfer.fileName}>{transfer.fileName}</span>
        </div>

        {canClose ? (
          <button
            type="button"
            className="mm-transfer-panel-close"
            onClick={onClose}
            aria-label="Fechar painel de transferência"
          >
            ×
          </button>
        ) : (
          <span className="mm-transfer-panel-percent">{transfer.percent}%</span>
        )}
      </div>

      <div className="mm-transfer-panel-detail">{transfer.detail}</div>

      <div
        className="mm-transfer-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={transfer.percent}
        aria-valuetext={`${transfer.percent}%`}
      >
        <div
          className="mm-transfer-progress-bar"
          style={{ width: `${Math.max(2, transfer.percent)}%` }}
        />
      </div>
    </aside>
  );
}

export default function DocumentsSection({
  user,
  organizationId,
}: DocumentsSectionProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const processingTimerRef = useRef<number | null>(null);
  const [files, setFiles] = useState<OrganizationFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyFileId, setBusyFileId] = useState<number | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<TransferPanelState | null>(null);

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
  const transferBusy =
    transfer?.status === "running" || transfer?.status === "processing";

  function stopProcessingTimer() {
    if (processingTimerRef.current !== null) {
      window.clearInterval(processingTimerRef.current);
      processingTimerRef.current = null;
    }
  }

  function clearDismissTimer() {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }

  function closeTransferPanel() {
    stopProcessingTimer();
    clearDismissTimer();
    setTransfer(null);
  }

  function scheduleTransferDismiss(delay = 2200) {
    clearDismissTimer();
    dismissTimerRef.current = window.setTimeout(() => {
      setTransfer(null);
      dismissTimerRef.current = null;
    }, delay);
  }

  function beginUploadProcessing(fileName: string) {
    setTransfer((current) => ({
      kind: "upload",
      status: "processing",
      fileName,
      percent: Math.max(current?.percent || 0, 92),
      detail: "Upload recebido. Salvando no Dropbox e catalogando no D1...",
    }));

    if (processingTimerRef.current !== null) return;

    processingTimerRef.current = window.setInterval(() => {
      setTransfer((current) => {
        if (!current || current.status !== "processing") return current;

        return {
          ...current,
          percent: Math.min(97, current.percent + 1),
        };
      });
    }, 450);
  }

  function updateRunningTransfer(
    kind: TransferKind,
    fileName: string,
    progress: FileTransferProgress,
  ) {
    if (kind === "upload" && progress.percent === 100) {
      beginUploadProcessing(fileName);
      return;
    }

    setTransfer((current) => {
      const calculatedPercent =
        progress.percent === null
          ? Math.min(kind === "upload" ? 84 : 94, (current?.percent || 2) + 4)
          : kind === "upload"
            ? Math.min(90, Math.max(2, Math.round(progress.percent * 0.9)))
            : Math.min(99, Math.max(2, progress.percent));

      const total = progress.total;
      const detail = total
        ? `${formatBytes(progress.loaded)} de ${formatBytes(total)}`
        : kind === "upload"
          ? "Enviando dados para o servidor..."
          : "Recebendo dados do servidor...";

      return {
        kind,
        status: "running",
        fileName,
        percent: calculatedPercent,
        detail,
      };
    });
  }

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

  useEffect(() => {
    return () => {
      stopProcessingTimer();
      clearDismissTimer();
    };
  }, []);

  async function handleUpload(file: File) {
    if (!organizationId || !canUpload || transferBusy) return;

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("idempotencyKey", crypto.randomUUID());

    stopProcessingTimer();
    clearDismissTimer();
    setTransfer({
      kind: "upload",
      status: "running",
      fileName: file.name,
      percent: 2,
      detail: "Preparando envio...",
    });
    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      await uploadOrganizationFileWithProgress(
        organizationId,
        formData,
        (progress) => updateRunningTransfer("upload", file.name, progress),
      );

      stopProcessingTimer();
      setTransfer({
        kind: "upload",
        status: "success",
        fileName: file.name,
        percent: 100,
        detail: "Arquivo salvo no Dropbox e catalogado com sucesso.",
      });

      await loadFiles();
      setMessage("Arquivo enviado e catalogado com sucesso.");
      scheduleTransferDismiss();
    } catch (requestError) {
      stopProcessingTimer();
      const formattedError = formatRequestError(
        requestError,
        "Não foi possível enviar o documento.",
      );

      setError(formattedError);
      setTransfer((current) => ({
        kind: "upload",
        status: "error",
        fileName: file.name,
        percent: Math.max(6, current?.percent || 6),
        detail: formattedError,
      }));
      scheduleTransferDismiss(6500);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDownload(file: OrganizationFile) {
    if (!organizationId || !canDownload || transferBusy) return;

    stopProcessingTimer();
    clearDismissTimer();
    setTransfer({
      kind: "download",
      status: "running",
      fileName: file.name || "documento",
      percent: 2,
      detail: "Preparando download...",
    });
    setBusyFileId(file.id);
    setError(null);
    setMessage(null);

    try {
      const response = await downloadOrganizationFileWithProgress(
        organizationId,
        file.id,
        (progress) =>
          updateRunningTransfer(
            "download",
            file.name || "documento",
            progress,
          ),
      );

      const fileName = response.fileName || file.name || "documento";
      downloadBlob(response.blob, fileName);
      setTransfer({
        kind: "download",
        status: "success",
        fileName,
        percent: 100,
        detail: "Download concluído. O arquivo foi disponibilizado pelo navegador.",
      });
      scheduleTransferDismiss();
    } catch (requestError) {
      const formattedError = formatRequestError(
        requestError,
        "Não foi possível baixar o documento.",
      );

      setError(formattedError);
      setTransfer((current) => ({
        kind: "download",
        status: "error",
        fileName: file.name || "documento",
        percent: Math.max(6, current?.percent || 6),
        detail: formattedError,
      }));
      scheduleTransferDismiss(6500);
    } finally {
      setBusyFileId(null);
    }
  }

  async function handleDelete(file: OrganizationFile) {
    if (!organizationId || !canDelete || transferBusy) return;

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
    <>
      {transfer ? (
        <TransferPanel transfer={transfer} onClose={closeTransferPanel} />
      ) : null}

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
                disabled={uploading || transferBusy}
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
                              disabled={busy || transferBusy}
                              onClick={() => void handleDownload(file)}
                            >
                              {busy ? "Processando..." : "Baixar"}
                            </button>
                          ) : null}

                          {canDelete ? (
                            <button
                              type="button"
                              className="mm-button danger"
                              disabled={busy || transferBusy}
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
    </>
  );
}
