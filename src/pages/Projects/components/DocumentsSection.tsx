import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { can, type AccessControlUser } from "../../../access-control/can";
import { PERMISSION } from "../../../access-control/permissions";
import { TableSkeleton } from "../../../components/loading/Skeleton";
import {
  deleteOrganizationFile,
  listOrganizationFiles,
  type OrganizationFile,
  type OrganizationFileListFacets,
  type OrganizationFileListPagination,
  type OrganizationFileSort,
} from "../../../lib/api";
import {
  downloadOrganizationFileWithProgress,
  uploadOrganizationFileWithProgress,
  type FileTransferProgress,
} from "../../../lib/file-transfer";
import { normalizeUserError } from "../../../lib/user-error-catalog";

import "./DocumentsTransferPanel.css";

type DocumentsSectionProps = {
  user?: AccessControlUser | null;
  organizationId?: number | string | null;
};

type TransferKind = "upload" | "download";
type TransferStatus = "running" | "processing" | "success" | "error";
type FeedbackStatus = "loading" | "success";

type TransferPanelState = {
  kind: TransferKind;
  status: TransferStatus;
  fileName: string;
  percent: number;
  detail: string;
};

type FeedbackState = {
  id: number;
  status: FeedbackStatus;
  message: string;
};

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const PROGRESS_TICK_MS = 24;
const DOCUMENT_HEADERS = ["Documento", "Tipo", "Tamanho", "Atualizado em", "Ações"];
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
type DocumentFilterState = {
  search: string;
  type: string;
  projectId: string;
  updatedFrom: string;
  updatedTo: string;
  sort: OrganizationFileSort;
};

const DEFAULT_DOCUMENT_FILTERS: DocumentFilterState = {
  search: "",
  type: "",
  projectId: "",
  updatedFrom: "",
  updatedTo: "",
  sort: "updated_desc",
};

const EMPTY_DOCUMENT_FACETS: OrganizationFileListFacets = {
  types: [],
  projects: [],
};

const EMPTY_DOCUMENT_PAGINATION: OrganizationFileListPagination = {
  limit: 50,
  total: 0,
  hasMore: false,
  nextCursor: null,
  sort: "updated_desc",
};

const DOCUMENT_SORT_OPTIONS: Array<{ value: OrganizationFileSort; label: string }> = [
  { value: "updated_desc", label: "Mais recentes" },
  { value: "updated_asc", label: "Mais antigos" },
  { value: "name_asc", label: "Nome A–Z" },
  { value: "name_desc", label: "Nome Z–A" },
  { value: "size_desc", label: "Maior tamanho" },
  { value: "size_asc", label: "Menor tamanho" },
];

function fileTypeLabel(value?: string | null) {
  const normalized = String(value || "").toLowerCase();
  const labels: Record<string, string> = {
    geojson: "GeoJSON",
    json: "JSON",
    csv: "CSV",
    spreadsheet: "Planilha",
    pdf: "PDF",
    image: "Imagem",
    zip: "ZIP",
    document: "Documento",
    text: "Texto",
    other: "Outro",
  };
  return labels[normalized] || normalized || "Outro";
}

function toFileListQuery(filters: DocumentFilterState, cursor?: string | null) {
  return {
    search: filters.search.trim() || undefined,
    type: filters.type || undefined,
    projectId: filters.projectId || undefined,
    updatedFrom: filters.updatedFrom || undefined,
    updatedTo: filters.updatedTo || undefined,
    sort: filters.sort,
    cursor: cursor || undefined,
    limit: 50,
  };
}


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
  const presentation = normalizeUserError(error);
  const message = presentation.message.trim() || fallback;
  const supportReference = presentation.supportReference;

  return supportReference ? `${message} (${supportReference})` : message;
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

  if (transfer.status === "processing") return "Finalizando";
  return transfer.kind === "upload" ? "Enviando" : "Baixando";
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
          style={{ width: `${transfer.percent}%` }}
        />
      </div>
    </aside>
  );
}

function FeedbackToast({ feedback }: { feedback: FeedbackState }) {
  return (
    <aside
      key={feedback.id}
      className={`mm-document-feedback ${feedback.status}`}
      role="status"
      aria-live="polite"
    >
      <span className="mm-document-feedback-icon" aria-hidden="true">
        {feedback.status === "loading" ? "" : "✓"}
      </span>
      <span>{feedback.message}</span>
    </aside>
  );
}

export default function DocumentsSection(props: DocumentsSectionProps) {
  // A new organization must not inherit a previous request's files or transfer.
  return <OrganizationDocuments key={String(props.organizationId ?? "none")} {...props} />;
}

function OrganizationDocuments({
  user,
  organizationId,
}: DocumentsSectionProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const processingTimerRef = useRef<number | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const progressTargetRef = useRef(0);
  const displayedProgressRef = useRef(0);
  const uploadInFlightRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const [files, setFiles] = useState<OrganizationFile[]>([]);
  const [filterDraft, setFilterDraft] = useState<DocumentFilterState>({
    ...DEFAULT_DOCUMENT_FILTERS,
  });
  const [appliedFilters, setAppliedFilters] = useState<DocumentFilterState>({
    ...DEFAULT_DOCUMENT_FILTERS,
  });
  const [facets, setFacets] = useState<OrganizationFileListFacets>(
    EMPTY_DOCUMENT_FACETS,
  );
  const [pagination, setPagination] = useState<OrganizationFileListPagination>(
    EMPTY_DOCUMENT_PAGINATION,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyFileId, setBusyFileId] = useState<number | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [transfer, setTransfer] = useState<TransferPanelState | null>(null);
  const [pendingUpload, setPendingUpload] = useState<{
    file: File;
    idempotencyKey: string;
    retryable: boolean;
  } | null>(null);

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

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: keyof DocumentFilterState; label: string }> = [];
    if (appliedFilters.search) {
      chips.push({ key: "search", label: `Busca: ${appliedFilters.search}` });
    }
    if (appliedFilters.type) {
      chips.push({
        key: "type",
        label: `Tipo: ${fileTypeLabel(appliedFilters.type)}`,
      });
    }
    if (appliedFilters.projectId) {
      const project = facets.projects.find(
        (item) => String(item.id) === appliedFilters.projectId,
      );
      chips.push({
        key: "projectId",
        label: `Projeto: ${project?.name || appliedFilters.projectId}`,
      });
    }
    if (appliedFilters.updatedFrom) {
      chips.push({
        key: "updatedFrom",
        label: `Desde: ${appliedFilters.updatedFrom}`,
      });
    }
    if (appliedFilters.updatedTo) {
      chips.push({
        key: "updatedTo",
        label: `Até: ${appliedFilters.updatedTo}`,
      });
    }
    return chips;
  }, [appliedFilters, facets.projects]);

  const hasActiveFilters = activeFilterChips.length > 0;
  const hasModifiedQuery =
    hasActiveFilters || appliedFilters.sort !== DEFAULT_DOCUMENT_FILTERS.sort;

  function stopProgressTimer() {
    if (progressTimerRef.current !== null) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  function startProgressTimer() {
    if (progressTimerRef.current !== null) return;

    progressTimerRef.current = window.setInterval(() => {
      const current = displayedProgressRef.current;
      const target = progressTargetRef.current;

      if (current >= target) {
        if (target >= 100) stopProgressTimer();
        return;
      }

      const next = Math.min(target, current + 1);
      displayedProgressRef.current = next;
      setTransfer((active) => (active ? { ...active, percent: next } : active));
    }, PROGRESS_TICK_MS);
  }

  function setProgressTarget(target: number) {
    const normalized = Math.max(0, Math.min(100, Math.round(target)));
    progressTargetRef.current = Math.max(progressTargetRef.current, normalized);
    startProgressTimer();
  }

  function resetProgress() {
    stopProgressTimer();
    progressTargetRef.current = 0;
    displayedProgressRef.current = 0;
  }

  function waitForProgress(target: number, timeout = 3500) {
    return new Promise<void>((resolve) => {
      const startedAt = Date.now();
      const poll = () => {
        if (
          displayedProgressRef.current >= target ||
          Date.now() - startedAt >= timeout
        ) {
          resolve();
          return;
        }
        window.setTimeout(poll, PROGRESS_TICK_MS);
      };
      poll();
    });
  }

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

  function clearFeedbackTimer() {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  }

  function showFeedback(
    status: FeedbackStatus,
    message: string,
    dismissAfter?: number,
  ) {
    clearFeedbackTimer();
    setFeedback({ id: Date.now(), status, message });

    if (dismissAfter) {
      feedbackTimerRef.current = window.setTimeout(() => {
        setFeedback(null);
        feedbackTimerRef.current = null;
      }, dismissAfter);
    }
  }

  function closeTransferPanel() {
    stopProcessingTimer();
    stopProgressTimer();
    clearDismissTimer();
    setTransfer(null);
  }

  function scheduleTransferDismiss(delay = 2200) {
    clearDismissTimer();
    dismissTimerRef.current = window.setTimeout(() => {
      resetProgress();
      setTransfer(null);
      dismissTimerRef.current = null;
    }, delay);
  }

  function beginUploadProcessing(fileName: string) {
    setTransfer((current) => ({
      kind: "upload",
      status: "processing",
      fileName,
      percent: current?.percent ?? displayedProgressRef.current,
      detail: "Finalizando...",
    }));
    setProgressTarget(96);

    if (processingTimerRef.current !== null) return;
    processingTimerRef.current = window.setInterval(() => {
      setProgressTarget(Math.min(98, progressTargetRef.current + 1));
    }, 650);
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

    const calculatedTarget =
      progress.percent === null
        ? Math.min(kind === "upload" ? 84 : 94, progressTargetRef.current + 3)
        : kind === "upload"
          ? Math.min(88, Math.round(progress.percent * 0.88))
          : Math.min(99, progress.percent);

    setProgressTarget(calculatedTarget);

    const detail = progress.total
      ? `${formatBytes(progress.loaded)} de ${formatBytes(progress.total)}`
      : kind === "upload"
        ? "Enviando..."
        : "Baixando...";

    setTransfer((current) => ({
      kind,
      status: "running",
      fileName,
      percent: current?.percent ?? displayedProgressRef.current,
      detail,
    }));
  }

  async function completeTransfer(
    kind: TransferKind,
    fileName: string,
    detail = "Concluído.",
  ) {
    stopProcessingTimer();
    setTransfer((current) => ({
      kind,
      status: "processing",
      fileName,
      percent: current?.percent ?? displayedProgressRef.current,
      detail: "Finalizando...",
    }));
    setProgressTarget(100);
    await waitForProgress(100);

    displayedProgressRef.current = 100;
    progressTargetRef.current = 100;
    setTransfer({
      kind,
      status: "success",
      fileName,
      percent: 100,
      detail,
    });
  }

  async function loadFiles({
    background = false,
    append = false,
    cursor = null,
    filters = appliedFilters,
  }: {
    background?: boolean;
    append?: boolean;
    cursor?: string | null;
    filters?: DocumentFilterState;
  } = {}) {
    if (!organizationId || !canView) {
      setFiles([]);
      setFacets(EMPTY_DOCUMENT_FACETS);
      setPagination(EMPTY_DOCUMENT_PAGINATION);
      return;
    }

    const sequence = ++loadSequenceRef.current;
    const showAsRefresh = background || (!append && files.length > 0);

    if (append) {
      setLoadingMore(true);
    } else if (showAsRefresh) {
      setRefreshing(true);
    } else {
      setInitialLoading(true);
    }
    setError(null);

    try {
      const response = await listOrganizationFiles(
        organizationId,
        toFileListQuery(filters, cursor),
      );
      if (!mountedRef.current || sequence !== loadSequenceRef.current) return;

      setFiles((current) =>
        append ? [...current, ...(response.files ?? [])] : response.files ?? [],
      );
      setFacets(response.facets ?? EMPTY_DOCUMENT_FACETS);
      setPagination(response.pagination ?? EMPTY_DOCUMENT_PAGINATION);
    } catch (requestError) {
      if (!mountedRef.current || sequence !== loadSequenceRef.current) return;
      setError(
        formatRequestError(
          requestError,
          "Não foi possível carregar os documentos.",
        ),
      );
    } finally {
      if (!mountedRef.current || sequence !== loadSequenceRef.current) return;
      if (append) {
        setLoadingMore(false);
      } else if (showAsRefresh) {
        setRefreshing(false);
      } else {
        setInitialLoading(false);
      }
    }
  }

  useEffect(() => {
    setFeedback(null);
    void loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, canView, appliedFilters]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopProcessingTimer();
      stopProgressTimer();
      clearDismissTimer();
      clearFeedbackTimer();
    };
  }, []);

  async function handleUpload(file: File, retryKey?: string) {
    if (!organizationId || !canUpload || transferBusy || uploadInFlightRef.current) return;

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const formData = new FormData();
    const idempotencyKey = retryKey || crypto.randomUUID();
    formData.append("file", file);
    formData.append("idempotencyKey", idempotencyKey);
    uploadInFlightRef.current = true;
    setPendingUpload({ file, idempotencyKey, retryable: false });

    stopProcessingTimer();
    clearDismissTimer();
    resetProgress();
    setTransfer({
      kind: "upload",
      status: "running",
      fileName: file.name,
      percent: 0,
      detail: "Preparando...",
    });
    setProgressTarget(3);
    setUploading(true);
    setError(null);
    setFeedback(null);

    try {
      await uploadOrganizationFileWithProgress(
        organizationId,
        formData,
        (progress) => {
          if (mountedRef.current) updateRunningTransfer("upload", file.name, progress);
        },
      );

      if (!mountedRef.current) return;

      await completeTransfer("upload", file.name);
      if (!mountedRef.current) return;
      setPendingUpload(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadFiles({ background: true });
      if (!mountedRef.current) return;
      showFeedback("success", "Documento enviado.", 3400);
      scheduleTransferDismiss();
    } catch (requestError) {
      if (!mountedRef.current) return;
      stopProcessingTimer();
      stopProgressTimer();
      const formattedError = formatRequestError(
        requestError,
        "Não foi possível enviar o documento.",
      );

      setError(formattedError);
      setPendingUpload({
        file,
        idempotencyKey,
        retryable: normalizeUserError(requestError).retryable,
      });
      setTransfer((current) => ({
        kind: "upload",
        status: "error",
        fileName: file.name,
        percent: current?.percent ?? displayedProgressRef.current,
        detail: formattedError,
      }));
      scheduleTransferDismiss(6500);
    } finally {
      uploadInFlightRef.current = false;
      setUploading(false);
    }
  }

  async function handleDownload(file: OrganizationFile) {
    if (!organizationId || !canDownload || transferBusy) return;

    stopProcessingTimer();
    clearDismissTimer();
    resetProgress();
    setTransfer({
      kind: "download",
      status: "running",
      fileName: file.name || "documento",
      percent: 0,
      detail: "Preparando...",
    });
    setProgressTarget(2);
    setBusyFileId(file.id);
    setError(null);
    setFeedback(null);

    try {
      const response = await downloadOrganizationFileWithProgress(
        organizationId,
        file.id,
        (progress) => {
          if (!mountedRef.current) return;
          updateRunningTransfer(
            "download",
            file.name || "documento",
            progress,
          );
        },
      );

      if (!mountedRef.current) return;

      const fileName = response.fileName || file.name || "documento";
      downloadBlob(response.blob, fileName);
      await completeTransfer("download", fileName);
      if (!mountedRef.current) return;
      showFeedback("success", "Download concluído.", 3400);
      scheduleTransferDismiss();
    } catch (requestError) {
      if (!mountedRef.current) return;
      stopProgressTimer();
      const formattedError = formatRequestError(
        requestError,
        "Não foi possível baixar o documento.",
      );

      setError(formattedError);
      setTransfer((current) => ({
        kind: "download",
        status: "error",
        fileName: file.name || "documento",
        percent: current?.percent ?? displayedProgressRef.current,
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
    showFeedback("loading", "Excluindo documento...");

    try {
      await deleteOrganizationFile(organizationId, file.id);
      if (!mountedRef.current) return;
      setFiles((current) =>
        current.filter((item) => String(item.id) !== String(file.id)),
      );
      await loadFiles({ background: true });
      if (!mountedRef.current) return;
      showFeedback("success", "Documento excluído.", 3400);
    } catch (requestError) {
      setFeedback(null);
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

  function applyDocumentFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = {
      ...filterDraft,
      search: filterDraft.search.trim(),
    };
    setFilterDraft(next);
    setFiles([]);
    setAppliedFilters(next);
  }

  function clearDocumentFilters() {
    const next = { ...DEFAULT_DOCUMENT_FILTERS };
    setFilterDraft(next);
    setFiles([]);
    setAppliedFilters(next);
  }

  function removeDocumentFilter(key: keyof DocumentFilterState) {
    const next = {
      ...appliedFilters,
      [key]: key === "sort" ? DEFAULT_DOCUMENT_FILTERS.sort : "",
    };
    setFilterDraft(next);
    setFiles([]);
    setAppliedFilters(next);
  }

  function loadMoreDocuments() {
    if (!pagination.hasMore || !pagination.nextCursor || loadingMore) return;
    void loadFiles({
      background: true,
      append: true,
      cursor: pagination.nextCursor,
    });
  }

  if (!organizationId) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Arquivos e Documentos</h2>
        <p>Selecione uma organização.</p>
      </section>
    );
  }

  if (!canView) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Arquivos e Documentos</h2>
        <p>Acesso não permitido.</p>
      </section>
    );
  }

  return (
    <>
      {transfer ? (
        <TransferPanel transfer={transfer} onClose={closeTransferPanel} />
      ) : null}
      {feedback ? <FeedbackToast feedback={feedback} /> : null}

      <section className="mm-card mm-section-card documents-section">
        <div className="projects-section-header">
          <h2>Arquivos e Documentos</h2>

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

        <form className="documents-filter-toolbar" onSubmit={applyDocumentFilters}>
          <label className="documents-filter-field documents-filter-search">
            <span>Buscar</span>
            <input
              type="search"
              value={filterDraft.search}
              placeholder="Nome do documento"
              onChange={(event) =>
                setFilterDraft((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
            />
          </label>

          <label className="documents-filter-field">
            <span>Tipo</span>
            <select
              value={filterDraft.type}
              onChange={(event) =>
                setFilterDraft((current) => ({
                  ...current,
                  type: event.target.value,
                }))
              }
            >
              <option value="">Todos</option>
              {facets.types.map((type) => (
                <option key={type} value={type}>
                  {fileTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>

          <label className="documents-filter-field">
            <span>Projeto</span>
            <select
              value={filterDraft.projectId}
              onChange={(event) =>
                setFilterDraft((current) => ({
                  ...current,
                  projectId: event.target.value,
                }))
              }
            >
              <option value="">Todos</option>
              {facets.projects.map((project) => (
                <option key={String(project.id)} value={String(project.id)}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="documents-filter-field">
            <span>De</span>
            <input
              type="date"
              value={filterDraft.updatedFrom}
              onChange={(event) =>
                setFilterDraft((current) => ({
                  ...current,
                  updatedFrom: event.target.value,
                }))
              }
            />
          </label>

          <label className="documents-filter-field">
            <span>Até</span>
            <input
              type="date"
              value={filterDraft.updatedTo}
              onChange={(event) =>
                setFilterDraft((current) => ({
                  ...current,
                  updatedTo: event.target.value,
                }))
              }
            />
          </label>

          <label className="documents-filter-field">
            <span>Ordenar</span>
            <select
              value={filterDraft.sort}
              onChange={(event) =>
                setFilterDraft((current) => ({
                  ...current,
                  sort: event.target.value as OrganizationFileSort,
                }))
              }
            >
              {DOCUMENT_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="documents-filter-actions">
            <button type="submit" className="mm-button secondary">
              Aplicar
            </button>
            <button
              type="button"
              className="mm-button ghost"
              disabled={!hasModifiedQuery}
              onClick={clearDocumentFilters}
            >
              Limpar filtros
            </button>
          </div>
        </form>

        {activeFilterChips.length > 0 ? (
          <div className="documents-filter-chips" aria-label="Filtros ativos">
            {activeFilterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="documents-filter-chip"
                onClick={() => removeDocumentFilter(chip.key)}
                aria-label={`Remover filtro ${chip.label}`}
              >
                <span>{chip.label}</span>
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        ) : null}

        {error ? <p className="mm-error-text" role="alert">{error}</p> : null}
        {pendingUpload?.retryable && canUpload && !uploading && !transferBusy ? (
          <button
            type="button"
            className="mm-button secondary"
            onClick={() => void handleUpload(pendingUpload.file, pendingUpload.idempotencyKey)}
          >
            Tentar enviar novamente
          </button>
        ) : null}

        {initialLoading && files.length === 0 ? (
          <TableSkeleton
            headers={DOCUMENT_HEADERS}
            rows={5}
            className="documents-table-skeleton"
          />
        ) : files.length === 0 && !error ? (
          <div className="projects-empty-state">
            {hasActiveFilters
              ? "Nenhum documento encontrado com os filtros atuais."
              : "Nenhum documento."}
          </div>
        ) : files.length === 0 ? null : (
          <>
            <div className="mm-table-wrap" aria-busy={refreshing || loadingMore}>
              <table className="documents-table">
                <thead>
                  <tr>
                    {DOCUMENT_HEADERS.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {files.map((file) => {
                    const busy = String(busyFileId) === String(file.id);

                    return (
                      <tr key={file.id}>
                        <td className="documents-name-cell">
                          <span className="documents-file-name" title={file.name}>
                            {file.name}
                          </span>
                          {file.projectName ? (
                            <span className="documents-file-project">
                              {file.projectName}
                            </span>
                          ) : null}
                        </td>
                        <td title={file.mimeType || undefined}>
                          {file.fileType ? fileTypeLabel(file.fileType) : file.mimeType || "—"}
                        </td>
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
              {refreshing ? (
                <span className="mm-sr-only" role="status">
                  Atualizando documentos.
                </span>
              ) : null}
            </div>

            <div className="documents-pagination">
              <span>
                Exibindo {files.length} de {pagination.total} documento
                {pagination.total === 1 ? "" : "s"}.
              </span>
              {pagination.hasMore && pagination.nextCursor ? (
                <button
                  type="button"
                  className="mm-button secondary"
                  disabled={loadingMore || refreshing}
                  onClick={loadMoreDocuments}
                >
                  {loadingMore ? "Carregando..." : "Carregar mais"}
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>
    </>
  );
}
