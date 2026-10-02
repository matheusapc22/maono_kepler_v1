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
  purgeOrganizationFilePermanently,
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
import "./DocumentsSection.css";
import { DocumentActionMenu, DocumentIcon } from "./DocumentsUi";

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
  const [permanentPurgeEnabled, setPermanentPurgeEnabled] = useState(false);
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
      setPermanentPurgeEnabled(false);
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
      setPermanentPurgeEnabled(
        Boolean(response.capabilities?.permanentPurgeEnabled),
      );
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

  async function handlePermanentPurge(file: OrganizationFile) {
    if (!organizationId || !canDelete || !canManage) return;

    const confirmation = window.prompt(
      `Excluir permanentemente "${file.name}"? Esta ação remove o binário do armazenamento e não pode ser desfeita. Digite EXCLUIR PERMANENTEMENTE para confirmar.`,
    );
    if (confirmation?.trim() !== "EXCLUIR PERMANENTEMENTE") return;

    setBusyFileId(file.id);
    setError(null);
    showFeedback("loading", "Excluindo documento permanentemente...");

    try {
      await purgeOrganizationFilePermanently(
        organizationId,
        file.id,
        confirmation.trim(),
      );
      if (!mountedRef.current) return;
      setFiles((current) =>
        current.filter((item) => String(item.id) !== String(file.id)),
      );
      await loadFiles({ background: true });
      if (!mountedRef.current) return;
      showFeedback("success", "Documento excluído permanentemente.", 4200);
    } catch (requestError) {
      setFeedback(null);
      setError(
        formatRequestError(
          requestError,
          "Não foi possível excluir permanentemente o documento.",
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

  if (!organizationId || !canView) {
    return <section className="documents-section mm-docs"><header className="mm-docs-header"><div className="mm-docs-heading"><DocumentIcon name="folder" /><div><h2>Arquivos e Documentos</h2><p>{!organizationId ? "Selecione uma organização." : "Acesso não permitido."}</p></div></div></header></section>;
  }

  const currentFolderId =
    appliedFilters.folderId && appliedFilters.folderId !== "root"
      ? String(appliedFilters.folderId)
      : null;
  const directFolders = folders
    .filter((folder) =>
      currentFolderId
        ? String(folder.parentId ?? "") === currentFolderId
        : folder.parentId == null,
    )
    .sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
    );
  const insideFolder = Boolean(currentFolderId);
  const folderPath = (id: string) =>
    documentFolderBreadcrumb(folders, id)
      .map((folder) => folder.name)
      .join(" / ");
  const countLabel = (count: number) =>
    `${count} documento${count === 1 ? "" : "s"}`;
  const resultsKey = JSON.stringify({
    state: documentState,
    search: appliedFilters.search,
    type: appliedFilters.type,
    projectId: appliedFilters.projectId,
    folderId: appliedFilters.folderId,
    updatedFrom: appliedFilters.updatedFrom,
    updatedTo: appliedFilters.updatedTo,
    sort: appliedFilters.sort,
  });

  return <>
    {transfer ? <TransferPanel transfer={transfer} onClose={closeTransferPanel} /> : null}
    {feedback ? <FeedbackToast feedback={feedback} /> : null}
    <section className="documents-section mm-docs" aria-labelledby="mm-docs-title">
      <div className="mm-docs-context"><span>Início</span><DocumentIcon name="arrow" /><span>Arquivos e Documentos</span></div>
      <header className="mm-docs-header">
        <div className="mm-docs-heading"><DocumentIcon name="folder" /><div><h2 id="mm-docs-title">Arquivos e Documentos</h2><p>Organize, armazene e compartilhe os documentos do seu projeto em um só lugar.</p></div></div>
        <div className="mm-docs-header-actions">
          <div className="mm-docs-view-switch" role="group" aria-label="Navegação de documentos">
            {documentState === "active"
              ? canDelete
                ? <button type="button" className="mm-docs-button" onClick={() => selectDocumentState("trash")}><DocumentIcon name="trash" />Lixeira</button>
                : null
              : <button type="button" className="mm-docs-button" onClick={() => selectDocumentState("active")}><DocumentIcon name="file" />Documentos</button>}
          </div>
          {canUpload && documentState === "active" ? <><button type="button" className="mm-docs-button is-primary" disabled={uploading || transferBusy} onClick={() => fileInputRef.current?.click()}><DocumentIcon name="upload" />{uploading ? "Enviando..." : "Enviar documento"}</button><input ref={fileInputRef} type="file" accept=".geojson,.json,.csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.zip,.txt,.docx" disabled={uploading || transferBusy} style={{ display: "none" }} onChange={event => { const file = event.target.files?.[0]; if (file) void handleUpload(file); }} /></> : null}
        </div>
      </header>

      {documentState === "active" ? <section className="mm-docs-panel" aria-labelledby="mm-docs-folders-title">
        <div className="mm-docs-panel-header"><div className="mm-docs-panel-title"><DocumentIcon name="folder" /><div><h3 id="mm-docs-folders-title">Pastas</h3><p>Organize seus documentos em pastas para facilitar o acesso e a gestão.</p></div></div>{canManage ? <button type="button" className="mm-docs-button is-outlined" disabled={busyFolderId !== null} onClick={() => void handleCreateFolder()}><DocumentIcon name="plus" />Nova pasta</button> : null}</div>
        {appliedFilters.folderId ? <nav className="mm-docs-breadcrumb documents-folder-breadcrumb" aria-label="Caminho da pasta"><button type="button" onClick={() => selectFolder("")}>Todos</button><DocumentIcon name="arrow" /><button type="button" aria-current={appliedFilters.folderId === "root" ? "page" : undefined} onClick={() => selectFolder("root")}>Raiz</button>{breadcrumbFolders.map(folder => <span key={String(folder.id)}><DocumentIcon name="arrow" /><button type="button" aria-current={appliedFilters.folderId === String(folder.id) ? "page" : undefined} onClick={() => selectFolder(String(folder.id))}>{folder.name}</button></span>)}</nav> : null}
        <nav className="mm-docs-folder-grid documents-folder-tree" aria-label={insideFolder ? "Subpastas da pasta atual" : "Pastas de documentos"}>
          {!insideFolder ? <>
            <article className={`mm-docs-folder-card ${appliedFilters.folderId === "" ? "is-active" : ""}`}><button type="button" className="mm-docs-folder-select" aria-pressed={appliedFilters.folderId === ""} onClick={() => selectFolder("")}><DocumentIcon name="folder" /><span><strong>Todos os documentos</strong><span>Todas as pastas</span></span></button></article>
            <article className={`mm-docs-folder-card ${appliedFilters.folderId === "root" ? "is-active" : ""}`}><button type="button" className="mm-docs-folder-select" aria-pressed={appliedFilters.folderId === "root"} onClick={() => selectFolder("root")}><DocumentIcon name="folder" /><span><strong>Raiz</strong><span>{countLabel(facets.rootCount)}</span></span></button></article>
          </> : null}
          {foldersLoading ? <p className="mm-docs-folder-status" role="status">Carregando pastas...</p> : directFolders.map(folder => {
            const path = folderPath(String(folder.id));
            return <article key={String(folder.id)} className={`mm-docs-folder-card ${appliedFilters.folderId === String(folder.id) ? "is-active" : ""}`}>
              <button type="button" className="mm-docs-folder-select" aria-pressed={appliedFilters.folderId === String(folder.id)} title={path} onClick={() => selectFolder(String(folder.id))}><DocumentIcon name="folder" /><span><strong>{folder.name}</strong><span>{countLabel(folderCountById.get(String(folder.id)) || 0)}</span></span></button>
              {canManage ? <DocumentActionMenu label={`Ações da pasta ${path}`} disabled={String(busyFolderId) === String(folder.id)} actions={[
                { label: "Renomear pasta", onSelect: () => void handleRenameFolder(folder) },
                { label: "Excluir pasta vazia", danger: true, onSelect: () => void handleDeleteFolder(folder) },
              ]} /> : null}
            </article>;
          })}
          {!foldersLoading && insideFolder && directFolders.length === 0 ? <p className="mm-docs-folder-empty">Esta pasta não possui subpastas.</p> : null}
        </nav>
      </section> : null}

      <section className="mm-docs-panel" aria-labelledby="mm-docs-filter-title">
        <div className="mm-docs-panel-header"><div className="mm-docs-panel-title"><DocumentIcon name="search" /><div><h3 id="mm-docs-filter-title">Buscar e filtrar</h3><p>Encontre documentos rapidamente usando os filtros abaixo.</p></div></div></div>
        <form className={`mm-docs-filters documents-filter-toolbar ${documentState === "trash" ? "is-trash" : ""}`} onSubmit={applyDocumentFilters}>
          <label className="mm-docs-field mm-docs-search"><span>Buscar</span><span className="mm-docs-search-control"><DocumentIcon name="search" /><input type="search" value={filterDraft.search} placeholder="Nome do documento..." onChange={event => setFilterDraft(current => ({ ...current, search: event.target.value }))} /></span></label>
          <label className="mm-docs-field mm-docs-type"><span>Tipo</span><select value={filterDraft.type} onChange={event => setFilterDraft(current => ({ ...current, type: event.target.value }))}><option value="">Todos</option>{facets.types.map(type => <option key={type} value={type}>{fileTypeLabel(type)}</option>)}</select></label>
          <label className="mm-docs-field mm-docs-project"><span>Projeto</span><select value={filterDraft.projectId} onChange={event => setFilterDraft(current => ({ ...current, projectId: event.target.value }))}><option value="">Todos</option>{facets.projects.map(project => <option key={String(project.id)} value={String(project.id)}>{project.name}</option>)}</select></label>
          {documentState === "active" ? <label className="mm-docs-field mm-docs-folder"><span>Pasta</span><select value={filterDraft.folderId} onChange={event => setFilterDraft(current => ({ ...current, folderId: event.target.value }))}><option value="">Todas</option><option value="root">Raiz</option>{folderTree.map(({ folder }) => <option key={String(folder.id)} value={String(folder.id)}>{folderPath(String(folder.id))}</option>)}</select></label> : null}
          <fieldset className="mm-docs-period"><legend>Período de atualização</legend><div><label className="mm-docs-field"><span>De</span><input type="date" value={filterDraft.updatedFrom} onChange={event => setFilterDraft(current => ({ ...current, updatedFrom: event.target.value }))} /></label><span className="mm-docs-date-arrow" aria-hidden="true">→</span><label className="mm-docs-field"><span>Até</span><input type="date" value={filterDraft.updatedTo} onChange={event => setFilterDraft(current => ({ ...current, updatedTo: event.target.value }))} /></label></div></fieldset>
          <label className="mm-docs-field mm-docs-sort"><span>Ordenar por</span><select value={filterDraft.sort} onChange={event => setFilterDraft(current => ({ ...current, sort: event.target.value as OrganizationFileSort }))}>{DOCUMENT_SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <div className="mm-docs-filter-actions"><button type="submit" className="mm-docs-button is-primary"><DocumentIcon name="search" />Aplicar</button><button type="button" className="mm-docs-button" disabled={!hasModifiedQuery} onClick={clearDocumentFilters}><DocumentIcon name="filter" />Limpar filtros</button></div>
        </form>
        {activeFilterChips.length > 0 ? <div className="mm-docs-chips" aria-label="Filtros ativos">{activeFilterChips.map(chip => <button type="button" key={chip.key} onClick={() => removeDocumentFilter(chip.key)} aria-label={`Remover filtro ${chip.label}`}><span>{chip.label}</span><DocumentIcon name="close" /></button>)}</div> : null}
      </section>

      {error ? <p className="mm-docs-error" role="alert">{error}</p> : null}
      {documentState === "active" && pendingUpload?.retryable && canUpload && !uploading && !transferBusy ? <button type="button" className="mm-docs-button is-outlined" onClick={() => void handleUpload(pendingUpload.file, pendingUpload.idempotencyKey)}>Tentar enviar novamente</button> : null}

      {documentState === "active" ? <ActiveDocumentsResults
        key={resultsKey}
        files={files}
        pagination={pagination}
        initialLoading={initialLoading}
        error={error}
        hasActiveFilters={hasActiveFilters}
        refreshing={refreshing}
        loadingMore={loadingMore}
        busyFileId={busyFileId}
        transferBusy={transferBusy}
        canManage={canManage}
        canDownload={canDownload}
        canDelete={canDelete}
        folderTree={folderTree}
        folderPath={folderPath}
        onMove={handleMoveFile}
        onDownload={handleDownload}
        onDelete={handleDelete}
        onLoadMore={loadMoreDocuments}
      /> : <section className="mm-docs-panel mm-docs-results" aria-labelledby="mm-docs-results-title">
        <div className="mm-docs-panel-header"><div className="mm-docs-panel-title"><DocumentIcon name="trash" /><div><h3 id="mm-docs-results-title">Documentos na Lixeira</h3><p>{initialLoading ? "Carregando documentos..." : error ? "A consulta precisa de atenção." : `${pagination.total} itens na Lixeira`}</p></div></div></div>
        {initialLoading && files.length === 0 ? <TableSkeleton headers={TRASH_HEADERS} rows={5} className="mm-docs-table-skeleton" /> : files.length === 0 && !error ? <div className="mm-docs-empty"><DocumentIcon name="trash" /><p>{hasActiveFilters ? "Nenhum documento encontrado com os filtros atuais." : "A Lixeira está vazia."}</p></div> : files.length === 0 ? null : <>
          <div className="mm-docs-table-scroll" role="region" aria-label="Tabela da Lixeira" tabIndex={0} aria-busy={refreshing || loadingMore}>
            <table className="mm-docs-table is-trash"><thead><tr>{TRASH_HEADERS.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{files.map(file => {
              const busy = String(busyFileId) === String(file.id);
              const expired = restoreExpired(file);
              return <tr key={file.id}><td><DocumentFileIdentity file={file} /></td><td>{trashedFromFolderLabel(file)}</td><td>{deletedByLabel(file)}</td><td>{formatDate(file.deletedAt)}</td><td>{formatDate(file.purgeAfter)}</td><td><div className="mm-docs-row-actions">
                {canDelete ? <button type="button" className="mm-docs-button" disabled={busy || expired} title={expired ? "Prazo de restauração expirado." : undefined} onClick={() => void handleRestore(file)}><DocumentIcon name="restore" />{busy ? "Processando..." : expired ? "Prazo expirado" : "Restaurar"}</button> : null}
                {permanentPurgeEnabled && canManage && canDelete ? <DocumentActionMenu label={`Ações de ${file.name}`} disabled={busy} actions={[{ label: "Excluir permanentemente", danger: true, onSelect: () => void handlePermanentPurge(file) }]} /> : null}
                {!canDelete ? "—" : null}
              </div></td></tr>;
            })}</tbody></table>
          </div>
          <div className="mm-docs-pagination"><span role="status">{refreshing ? "Atualizando documentos." : `Exibindo ${files.length} de ${pagination.total} itens na Lixeira.`}</span>{pagination.hasMore && pagination.nextCursor ? <button type="button" className="mm-docs-button is-outlined" disabled={loadingMore || refreshing} onClick={loadMoreDocuments}>{loadingMore ? "Carregando..." : "Carregar mais"}</button> : null}</div>
        </>}
      </section>}
    </section>
  </>;
}

type ActiveDocumentsResultsProps = {
  files: OrganizationFile[];
  pagination: OrganizationFileListPagination;
  initialLoading: boolean;
  error: string | null;
  hasActiveFilters: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  busyFileId: number | string | null;
  transferBusy: boolean;
  canManage: boolean;
  canDownload: boolean;
  canDelete: boolean;
  folderTree: DocumentFolderTreeEntry[];
  folderPath: (id: string) => string;
  onMove: (file: OrganizationFile, targetFolderId: string) => Promise<void>;
  onDownload: (file: OrganizationFile) => Promise<void>;
  onDelete: (file: OrganizationFile) => Promise<void>;
  onLoadMore: () => void;
};

function documentVisualType(file: OrganizationFile) {
  const type = String(file.fileType || fileExtension(file.name) || "other").toLowerCase();
  if (type === "json" || type === "geojson") return { tone: "code", mark: "{ }" };
  if (type === "pdf") return { tone: "pdf", mark: "PDF" };
  if (["csv", "spreadsheet", "xlsx", "xls"].includes(type)) return { tone: "sheet", mark: "XLS" };
  if (["image", "png", "jpg", "jpeg", "webp"].includes(type)) return { tone: "image", mark: "IMG" };
  if (type === "zip") return { tone: "zip", mark: "ZIP" };
  return { tone: "document", mark: "DOC" };
}

function DocumentFileIdentity({ file }: { file: OrganizationFile }) {
  const visual = documentVisualType(file);
  return <div className="mm-docs-file-identity"><span className={`mm-docs-file-icon is-${visual.tone}`} aria-hidden="true"><span>{visual.mark}</span></span><span className="mm-docs-file-copy"><span className="documents-file-name" title={file.name}>{file.name}</span>{file.projectName ? <span className="documents-file-project">{file.projectName}</span> : null}</span></div>;
}

function ActiveDocumentActions({
  file,
  busy,
  transferBusy,
  canManage,
  canDownload,
  canDelete,
  folderTree,
  folderPath,
  onMove,
  onDownload,
  onDelete,
}: {
  file: OrganizationFile;
  busy: boolean;
  transferBusy: boolean;
  canManage: boolean;
  canDownload: boolean;
  canDelete: boolean;
  folderTree: DocumentFolderTreeEntry[];
  folderPath: (id: string) => string;
  onMove: (file: OrganizationFile, targetFolderId: string) => Promise<void>;
  onDownload: (file: OrganizationFile) => Promise<void>;
  onDelete: (file: OrganizationFile) => Promise<void>;
}) {
  return <div className="mm-docs-row-actions">
    {canManage ? <span className="mm-docs-move-control"><DocumentIcon name="folder" /><select className="mm-docs-move" value="" disabled={busy || transferBusy} aria-label={`Mover ${file.name} para pasta`} onChange={event => { const target = event.target.value; if (target) void onMove(file, target); }}><option value="">Mover para...</option><option value="root">Raiz</option>{folderTree.map(({ folder }) => <option key={String(folder.id)} value={String(folder.id)} disabled={String(file.folderId) === String(folder.id)}>{folderPath(String(folder.id))}</option>)}</select><DocumentIcon name="chevron" /></span> : null}
    {canDownload ? <button type="button" className="mm-docs-button" disabled={busy || transferBusy} onClick={() => void onDownload(file)}><DocumentIcon name="download" />{busy ? "Processando..." : "Baixar"}</button> : null}
    {canDelete ? <DocumentActionMenu label={`Ações de ${file.name}`} disabled={busy || transferBusy} actions={[{ label: "Excluir", danger: true, onSelect: () => void onDelete(file) }]} /> : null}
    {!canDownload && !canDelete && !canManage ? "—" : null}
  </div>;
}

function ActiveDocumentsResults(props: ActiveDocumentsResultsProps) {
  const {
    files,
    pagination,
    initialLoading,
    error,
    hasActiveFilters,
    refreshing,
    loadingMore,
  } = props;
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [pageSize, setPageSize] = useState(10);
  const [pageIndex, setPageIndex] = useState(0);
  const [pendingNext, setPendingNext] = useState(false);

  const totalPages = Math.max(1, Math.ceil(pagination.total / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const start = safePageIndex * pageSize;
  const visibleFiles = files.slice(start, start + pageSize);
  const firstShown = pagination.total === 0 ? 0 : start + 1;
  const lastShown = Math.min(start + visibleFiles.length, pagination.total);
  const canGoPrevious = safePageIndex > 0;
  const canGoNext = safePageIndex + 1 < totalPages;

  useEffect(() => {
    if (pageIndex !== safePageIndex) setPageIndex(safePageIndex);
  }, [pageIndex, safePageIndex]);

  useEffect(() => {
    if (!pendingNext) return;
    const nextStart = (safePageIndex + 1) * pageSize;
    if (files.length > nextStart || (!pagination.hasMore && files.length > start)) {
      setPageIndex((current) => Math.min(current + 1, totalPages - 1));
      setPendingNext(false);
    }
  }, [pendingNext, files.length, pagination.hasMore, safePageIndex, pageSize, start, totalPages]);

  function goNext() {
    if (!canGoNext || pendingNext) return;
    const nextStart = (safePageIndex + 1) * pageSize;
    if (nextStart < files.length) {
      setPageIndex(safePageIndex + 1);
      return;
    }
    if (pagination.hasMore && pagination.nextCursor) {
      setPendingNext(true);
      props.onLoadMore();
    }
  }

  return <section className="mm-docs-panel mm-docs-results" aria-labelledby="mm-docs-results-title">
    <div className="mm-docs-panel-header"><div className="mm-docs-panel-title"><DocumentIcon name="file" /><div><h3 id="mm-docs-results-title">Documentos encontrados</h3><p>{initialLoading ? "Carregando documentos..." : error ? "A consulta precisa de atenção." : `Exibindo ${firstShown}–${lastShown} de ${pagination.total} documentos.`}</p></div></div>
      <div className="mm-docs-view-mode" role="group" aria-label="Modo de visualização"><button type="button" className="mm-docs-view-mode-button" aria-label="Visualização em lista" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}><DocumentIcon name="list" /></button><button type="button" className="mm-docs-view-mode-button" aria-label="Visualização em grade" aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")}><DocumentIcon name="grid" /></button></div>
    </div>
    {initialLoading && files.length === 0 ? <TableSkeleton headers={DOCUMENT_HEADERS} rows={5} className="mm-docs-table-skeleton" /> : files.length === 0 && !error ? <div className="mm-docs-empty"><DocumentIcon name="folder" /><p>{hasActiveFilters ? "Nenhum documento encontrado com os filtros atuais." : "Nenhum documento."}</p></div> : files.length === 0 ? null : <>
      {viewMode === "list" ? <div className="mm-docs-table-scroll" role="region" aria-label="Tabela de documentos" tabIndex={0} aria-busy={refreshing || loadingMore || pendingNext}>
        <table className="mm-docs-table"><thead><tr>{DOCUMENT_HEADERS.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{visibleFiles.map(file => {
          const busy = String(props.busyFileId) === String(file.id);
          return <tr key={file.id}><td><DocumentFileIdentity file={file} /></td><td title={file.mimeType || undefined}><span className="mm-docs-type-badge">{file.fileType ? fileTypeLabel(file.fileType) : file.mimeType || "—"}</span></td><td>{formatBytes(file.size)}</td><td>{formatDate(file.updatedAt || file.createdAt)}</td><td><ActiveDocumentActions {...props} file={file} busy={busy} /></td></tr>;
        })}</tbody></table>
      </div> : <div className="mm-docs-file-grid" role="list" aria-label="Grade de documentos">{visibleFiles.map(file => {
        const busy = String(props.busyFileId) === String(file.id);
        return <article className="mm-docs-file-card" role="listitem" key={file.id}><DocumentFileIdentity file={file} /><div className="mm-docs-file-card-meta"><span><small>Tipo</small><strong>{file.fileType ? fileTypeLabel(file.fileType) : file.mimeType || "—"}</strong></span><span><small>Tamanho</small><strong>{formatBytes(file.size)}</strong></span><span><small>Atualizado em</small><strong>{formatDate(file.updatedAt || file.createdAt)}</strong></span></div><ActiveDocumentActions {...props} file={file} busy={busy} /></article>;
      })}</div>}
      <div className="mm-docs-pagination"><span role="status">{refreshing || pendingNext ? "Atualizando documentos." : `Exibindo ${firstShown}–${lastShown} de ${pagination.total} documentos.`}</span><div className="mm-docs-page-controls"><label>Itens por página <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPageIndex(0); setPendingNext(false); }}><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></label><button type="button" className="mm-docs-page-arrow is-previous" aria-label="Página anterior" disabled={!canGoPrevious || refreshing || loadingMore || pendingNext} onClick={() => setPageIndex(Math.max(0, safePageIndex - 1))}><DocumentIcon name="chevron" /></button><span className="mm-docs-page-number" aria-current="page">{safePageIndex + 1}</span><button type="button" className="mm-docs-page-arrow" aria-label="Próxima página" disabled={!canGoNext || refreshing || loadingMore || pendingNext} onClick={goNext}><DocumentIcon name="chevron" /></button></div></div>
    </>}
  </section>;
}
