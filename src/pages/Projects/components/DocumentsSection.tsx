import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { can, type AccessControlUser } from "../../../access-control/can";
import { PERMISSION } from "../../../access-control/permissions";
import { TableSkeleton } from "../../../components/loading/Skeleton";
import {
  createOrganizationDocumentFolder,
  deleteOrganizationDocumentFolder,
  deleteOrganizationFile,
  listOrganizationDocumentFolders,
  listOrganizationFiles,
  moveOrganizationFileToFolder,
  restoreOrganizationFile,
  updateOrganizationDocumentFolder,
  type OrganizationDocumentFolder,
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
const TRASH_HEADERS = [
  "Documento",
  "Pasta anterior",
  "Excluído por",
  "Excluído em",
  "Exclusão definitiva em",
  "Ações",
];
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
  folderId: string;
  updatedFrom: string;
  updatedTo: string;
  sort: OrganizationFileSort;
};

const DEFAULT_DOCUMENT_FILTERS: DocumentFilterState = {
  search: "",
  type: "",
  projectId: "",
  folderId: "",
  updatedFrom: "",
  updatedTo: "",
  sort: "updated_desc",
};

const EMPTY_DOCUMENT_FACETS: OrganizationFileListFacets = {
  types: [],
  projects: [],
  rootCount: 0,
  folderCounts: [],
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

function toFileListQuery(
  filters: DocumentFilterState,
  cursor?: string | null,
  state: "active" | "trash" = "active",
) {
  return {
    search: filters.search.trim() || undefined,
    type: filters.type || undefined,
    projectId: filters.projectId || undefined,
    folderId: filters.folderId || undefined,
    state,
    updatedFrom: filters.updatedFrom || undefined,
    updatedTo: filters.updatedTo || undefined,
    sort: filters.sort,
    cursor: cursor || undefined,
    limit: 50,
  };
}


type DocumentFolderTreeEntry = {
  folder: OrganizationDocumentFolder;
  depth: number;
};

function flattenDocumentFolderTree(
  folders: OrganizationDocumentFolder[],
): DocumentFolderTreeEntry[] {
  const children = new Map<string, OrganizationDocumentFolder[]>();

  for (const folder of folders) {
    const parentKey = folder.parentId == null ? "root" : String(folder.parentId);
    const current = children.get(parentKey) || [];
    current.push(folder);
    children.set(parentKey, current);
  }

  for (const siblings of children.values()) {
    siblings.sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
    );
  }

  const entries: DocumentFolderTreeEntry[] = [];
  const visit = (parentKey: string, depth: number) => {
    for (const folder of children.get(parentKey) || []) {
      entries.push({ folder, depth });
      visit(String(folder.id), depth + 1);
    }
  };

  visit("root", 0);
  return entries;
}

function documentFolderBreadcrumb(
  folders: OrganizationDocumentFolder[],
  folderId: string,
) {
  if (!folderId) return [];
  if (folderId === "root") return [];

  const byId = new Map(folders.map((folder) => [String(folder.id), folder]));
  const lineage: OrganizationDocumentFolder[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);

  while (current && !seen.has(String(current.id))) {
    lineage.unshift(current);
    seen.add(String(current.id));
    current =
      current.parentId == null ? undefined : byId.get(String(current.parentId));
  }

  return lineage;
}

function formatBytes(size?: number | null) {
  if (!size || size <= 0) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function deletedByLabel(file: OrganizationFile) {
  const actor = file.deletedBy;
  if (!actor) return "—";
  return actor.name || actor.email || `Usuário ${actor.id}`;
}

function trashedFromFolderLabel(file: OrganizationFile) {
  if (file.trashedFromFolderId == null) return "Raiz";
  return file.trashedFromFolderName || "Pasta removida";
}

function restoreExpired(file: OrganizationFile) {
  if (!file.purgeAfter) return false;
  const expiresAt = new Date(file.purgeAfter).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function formatDate(value?: string | null) {
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
  const [documentState, setDocumentState] = useState<"active" | "trash">("active");
  const [folders, setFolders] = useState<OrganizationDocumentFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [busyFolderId, setBusyFolderId] = useState<number | string | null>(null);
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
  const canManage = can(user, PERMISSION.DOCUMENT_MANAGE, permissionContext);
  const transferBusy =
    transfer?.status === "running" || transfer?.status === "processing";

  const folderTree = useMemo(() => flattenDocumentFolderTree(folders), [folders]);
  const folderCountById = useMemo(
    () =>
      new Map(
        facets.folderCounts.map((item) => [
          String(item.folderId),
          Number(item.count || 0),
        ]),
      ),
    [facets.folderCounts],
  );
  const breadcrumbFolders = useMemo(
    () => documentFolderBreadcrumb(folders, appliedFilters.folderId),
    [folders, appliedFilters.folderId],
  );

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
    if (appliedFilters.folderId) {
      const folder =
        appliedFilters.folderId === "root"
          ? null
          : folders.find(
              (item) => String(item.id) === appliedFilters.folderId,
            );
      chips.push({
        key: "folderId",
        label:
          appliedFilters.folderId === "root"
            ? "Pasta: Raiz"
            : `Pasta: ${folder?.name || appliedFilters.folderId}`,
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
  }, [appliedFilters, facets.projects, folders]);

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

  async function loadFolders() {
    if (!organizationId || !canView) {
      setFolders([]);
      return;
    }

    setFoldersLoading(true);
    try {
      const response = await listOrganizationDocumentFolders(organizationId);
      if (!mountedRef.current) return;
      setFolders(response.folders ?? []);
    } catch (requestError) {
      if (!mountedRef.current) return;
      setError(
        formatRequestError(
          requestError,
          "Não foi possível carregar as pastas.",
        ),
      );
    } finally {
      if (mountedRef.current) setFoldersLoading(false);
    }
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
        toFileListQuery(filters, cursor, documentState),
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
  }, [organizationId, canView, appliedFilters, documentState]);

  useEffect(() => {
    void loadFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, canView]);

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
      `Mover o documento "${file.name}" para a Lixeira? Ele poderá ser restaurado por até 10 dias.`,
    );
    if (!confirmed) return;

    setBusyFileId(file.id);
    setError(null);
    showFeedback("loading", "Movendo documento para a Lixeira...");

    try {
      await deleteOrganizationFile(organizationId, file.id);
      if (!mountedRef.current) return;
      setFiles((current) =>
        current.filter((item) => String(item.id) !== String(file.id)),
      );
      await loadFiles({ background: true });
      if (!mountedRef.current) return;
      showFeedback("success", "Documento movido para a Lixeira.", 3400);
    } catch (requestError) {
      setFeedback(null);
      setError(
        formatRequestError(
          requestError,
          "Não foi possível mover o documento para a Lixeira.",
        ),
      );
    } finally {
      setBusyFileId(null);
    }
  }

  async function handleRestore(file: OrganizationFile) {
    if (!organizationId || !canDelete) return;

    setBusyFileId(file.id);
    setError(null);
    showFeedback("loading", "Restaurando documento...");

    try {
      const response = await restoreOrganizationFile(organizationId, file.id);
      if (!mountedRef.current) return;
      await loadFiles({ background: true });
      if (!mountedRef.current) return;
      showFeedback(
        "success",
        response.originalFolderMissing
          ? "Documento restaurado na Raiz porque a pasta anterior não existe mais."
          : response.restoredToRoot
            ? "Documento restaurado na Raiz."
            : "Documento restaurado na pasta anterior.",
        4200,
      );
    } catch (requestError) {
      setFeedback(null);
      setError(
        formatRequestError(
          requestError,
          "Não foi possível restaurar o documento.",
        ),
      );
    } finally {
      setBusyFileId(null);
    }
  }

  function selectDocumentState(next: "active" | "trash") {
    if (next === "trash" && !canDelete) return;
    const clean = { ...DEFAULT_DOCUMENT_FILTERS };
    setFilterDraft(clean);
    setAppliedFilters(clean);
    setFiles([]);
    setDocumentState(next);
    setError(null);
    setFeedback(null);
  }

  function selectFolder(folderId: string) {
    const next = {
      ...appliedFilters,
      folderId,
    };
    setFilterDraft(next);
    setFiles([]);
    setAppliedFilters(next);
  }

  async function handleCreateFolder() {
    if (!organizationId || !canManage) return;
    const name = window.prompt("Nome da nova pasta:");
    if (!name?.trim()) return;

    const parentId =
      appliedFilters.folderId &&
      appliedFilters.folderId !== "root"
        ? appliedFilters.folderId
        : null;

    setBusyFolderId("create");
    setError(null);
    try {
      const response = await createOrganizationDocumentFolder(organizationId, {
        name,
        parentId,
      });
      if (!mountedRef.current) return;
      await loadFolders();
      selectFolder(String(response.folder.id));
      showFeedback("success", "Pasta criada.", 3000);
    } catch (requestError) {
      setError(
        formatRequestError(requestError, "Não foi possível criar a pasta."),
      );
    } finally {
      setBusyFolderId(null);
    }
  }

  async function handleRenameFolder(folder: OrganizationDocumentFolder) {
    if (!organizationId || !canManage) return;
    const name = window.prompt("Novo nome da pasta:", folder.name);
    if (!name?.trim() || name.trim() === folder.name) return;

    setBusyFolderId(folder.id);
    setError(null);
    try {
      await updateOrganizationDocumentFolder(organizationId, folder.id, { name });
      if (!mountedRef.current) return;
      await loadFolders();
      showFeedback("success", "Pasta renomeada.", 3000);
    } catch (requestError) {
      setError(
        formatRequestError(requestError, "Não foi possível renomear a pasta."),
      );
    } finally {
      setBusyFolderId(null);
    }
  }

  async function handleDeleteFolder(folder: OrganizationDocumentFolder) {
    if (!organizationId || !canManage) return;
    const confirmed = window.confirm(
      `Excluir a pasta "${folder.name}"? Apenas pastas vazias podem ser excluídas.`,
    );
    if (!confirmed) return;

    setBusyFolderId(folder.id);
    setError(null);
    try {
      await deleteOrganizationDocumentFolder(organizationId, folder.id);
      if (!mountedRef.current) return;
      if (appliedFilters.folderId === String(folder.id)) selectFolder("root");
      await loadFolders();
      await loadFiles({ background: true });
      showFeedback("success", "Pasta excluída.", 3000);
    } catch (requestError) {
      setError(
        formatRequestError(
          requestError,
          "Não foi possível excluir a pasta. Confirme se ela está vazia.",
        ),
      );
    } finally {
      setBusyFolderId(null);
    }
  }

  async function handleMoveFile(
    file: OrganizationFile,
    targetFolderId: string,
  ) {
    if (!organizationId || !canManage || !targetFolderId) return;
    const folderId = targetFolderId === "root" ? null : targetFolderId;

    setBusyFileId(file.id);
    setError(null);
    showFeedback("loading", "Movendo documento...");
    try {
      await moveOrganizationFileToFolder(organizationId, file.id, folderId);
      if (!mountedRef.current) return;
      await Promise.all([
        loadFiles({ background: true }),
        loadFolders(),
      ]);
      if (!mountedRef.current) return;
      showFeedback("success", "Documento movido.", 3000);
    } catch (requestError) {
      setFeedback(null);
      setError(
        formatRequestError(requestError, "Não foi possível mover o documento."),
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

          <div className="documents-header-actions">
            <div className="documents-view-switch" role="group" aria-label="Visão de documentos">
              <button
                type="button"
                className={`mm-button ${documentState === "active" ? "secondary" : "ghost"}`}
                onClick={() => selectDocumentState("active")}
              >
                Documentos
              </button>
              {canDelete ? (
                <button
                  type="button"
                  className={`mm-button ${documentState === "trash" ? "secondary" : "ghost"}`}
                  onClick={() => selectDocumentState("trash")}
                >
                  Lixeira
                </button>
              ) : null}
            </div>

            {canUpload && documentState === "active" ? (
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
        </div>

        {documentState === "active" ? (
          <div className="documents-folder-browser">
          <div className="documents-folder-browser-header">
            <div>
              <strong>Pastas</strong>
              <span>Organização lógica dos documentos</span>
            </div>
            {canManage ? (
              <button
                type="button"
                className="mm-button secondary"
                disabled={busyFolderId !== null}
                onClick={() => void handleCreateFolder()}
              >
                Nova pasta
              </button>
            ) : null}
          </div>

          <div className="documents-folder-tree" role="tree" aria-label="Árvore de pastas">
            <div className="documents-folder-row root-row">
              <button
                type="button"
                className={`documents-folder-select ${appliedFilters.folderId === "" ? "active" : ""}`}
                onClick={() => selectFolder("")}
              >
                <span>Todos os documentos</span>
              </button>
            </div>
            <div className="documents-folder-row root-row">
              <button
                type="button"
                className={`documents-folder-select ${appliedFilters.folderId === "root" ? "active" : ""}`}
                onClick={() => selectFolder("root")}
              >
                <span>Raiz</span>
                <span className="documents-folder-count">{facets.rootCount}</span>
              </button>
            </div>

            {foldersLoading ? (
              <span className="documents-folder-loading">Carregando pastas...</span>
            ) : folderTree.length === 0 ? (
              <span className="documents-folder-empty">Nenhuma pasta criada.</span>
            ) : (
              folderTree.map(({ folder, depth }) => {
                const active = appliedFilters.folderId === String(folder.id);
                const busy = String(busyFolderId) === String(folder.id);
                return (
                  <div
                    key={String(folder.id)}
                    className="documents-folder-row"
                    role="treeitem"
                    aria-level={depth + 1}
                    style={{ paddingLeft: `${depth * 18}px` }}
                  >
                    <button
                      type="button"
                      className={`documents-folder-select ${active ? "active" : ""}`}
                      onClick={() => selectFolder(String(folder.id))}
                    >
                      <span className="documents-folder-name" title={folder.name}>
                        {folder.name}
                      </span>
                      <span className="documents-folder-count">
                        {folderCountById.get(String(folder.id)) || 0}
                      </span>
                    </button>
                    {canManage ? (
                      <div className="documents-folder-actions">
                        <button
                          type="button"
                          className="documents-folder-action"
                          disabled={busy}
                          onClick={() => void handleRenameFolder(folder)}
                          aria-label={`Renomear pasta ${folder.name}`}
                        >
                          Renomear
                        </button>
                        <button
                          type="button"
                          className="documents-folder-action danger"
                          disabled={busy}
                          onClick={() => void handleDeleteFolder(folder)}
                          aria-label={`Excluir pasta ${folder.name}`}
                        >
                          Excluir
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
          </div>
        ) : null}

        {documentState === "active" ? (
          <nav className="documents-folder-breadcrumb" aria-label="Caminho da pasta">
          <button type="button" onClick={() => selectFolder("")}>
            Todos
          </button>
          {appliedFilters.folderId ? (
            <>
              <span aria-hidden="true">/</span>
              <button type="button" onClick={() => selectFolder("root")}>
                Raiz
              </button>
            </>
          ) : null}
          {breadcrumbFolders.map((folder) => (
            <span key={String(folder.id)} className="documents-folder-breadcrumb-part">
              <span aria-hidden="true">/</span>
              <button
                type="button"
                onClick={() => selectFolder(String(folder.id))}
                aria-current={
                  appliedFilters.folderId === String(folder.id)
                    ? "page"
                    : undefined
                }
              >
                {folder.name}
              </button>
            </span>
          ))}
          </nav>
        ) : null}

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

          {documentState === "active" ? (
            <label className="documents-filter-field">
            <span>Pasta</span>
            <select
              value={filterDraft.folderId}
              onChange={(event) =>
                setFilterDraft((current) => ({
                  ...current,
                  folderId: event.target.value,
                }))
              }
            >
              <option value="">Todas</option>
              <option value="root">Raiz</option>
              {folderTree.map(({ folder, depth }) => (
                <option key={String(folder.id)} value={String(folder.id)}>
                  {`${"— ".repeat(depth)}${folder.name}`}
                </option>
              ))}
            </select>
            </label>
          ) : null}

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
        {documentState === "active" && pendingUpload?.retryable && canUpload && !uploading && !transferBusy ? (
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
            headers={documentState === "trash" ? TRASH_HEADERS : DOCUMENT_HEADERS}
            rows={5}
            className="documents-table-skeleton"
          />
        ) : files.length === 0 && !error ? (
          <div className="projects-empty-state">
            {hasActiveFilters
              ? "Nenhum documento encontrado com os filtros atuais."
              : documentState === "trash"
                ? "A Lixeira está vazia."
                : "Nenhum documento."}
          </div>
        ) : files.length === 0 ? null : (
          <>
            <div className="mm-table-wrap" aria-busy={refreshing || loadingMore}>
              <table className={documentState === "trash" ? "documents-table documents-trash-table" : "documents-table"}>
                <thead>
                  <tr>
                    {(documentState === "trash" ? TRASH_HEADERS : DOCUMENT_HEADERS).map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {files.map((file) => {
                    const busy = String(busyFileId) === String(file.id);

                    if (documentState === "trash") {
                      const expired = restoreExpired(file);
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
                          <td>{trashedFromFolderLabel(file)}</td>
                          <td>{deletedByLabel(file)}</td>
                          <td>{formatDate(file.deletedAt)}</td>
                          <td>{formatDate(file.purgeAfter)}</td>
                          <td>
                            {canDelete ? (
                              <button
                                type="button"
                                className="mm-button secondary"
                                disabled={busy || expired}
                                onClick={() => void handleRestore(file)}
                                title={expired ? "Prazo de restauração expirado." : undefined}
                              >
                                {busy ? "Restaurando..." : expired ? "Prazo expirado" : "Restaurar"}
                              </button>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    }

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
                            {canManage ? (
                              <select
                                className="documents-move-select"
                                value=""
                                disabled={busy || transferBusy}
                                aria-label={`Mover ${file.name} para pasta`}
                                onChange={(event) => {
                                  const target = event.target.value;
                                  if (target) void handleMoveFile(file, target);
                                }}
                              >
                                <option value="">Mover para...</option>
                                <option value="root">Raiz</option>
                                {folderTree.map(({ folder, depth }) => (
                                  <option
                                    key={String(folder.id)}
                                    value={String(folder.id)}
                                    disabled={String(file.folderId) === String(folder.id)}
                                  >
                                    {`${"— ".repeat(depth)}${folder.name}`}
                                  </option>
                                ))}
                              </select>
                            ) : null}

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
                Exibindo {files.length} de {pagination.total} {documentState === "trash" ? "item" : "documento"}
                {pagination.total === 1 ? "" : "s"}{documentState === "trash" ? " na Lixeira" : ""}.
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
