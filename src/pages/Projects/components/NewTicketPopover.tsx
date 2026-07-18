import { useEffect, useMemo, useRef, useState } from "react";

import {
  createTicket,
  TicketApiError,
  toTicketApiError,
  uploadTicketAttachment,
} from "./tickets-api";
import TicketErrorNotice from "./TicketErrorNotice";
import { dateInputToIso } from "./ticket-format";
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  type CreateTicketPayload,
  type Ticket,
  type TicketAttachmentLimits,
  type TicketCategory,
  type TicketPerson,
  type TicketPriority,
} from "./ticket-types";

type NewTicketPopoverProps = {
  open: boolean;
  organizationId: number | string;
  assignees: TicketPerson[];
  canManage: boolean;
  attachmentLimits: TicketAttachmentLimits;
  onClose: () => void;
  onCreated: (ticket: Ticket, failedFiles: File[]) => void;
};

type UploadState = {
  progress: number;
  status: "queued" | "uploading" | "finalizing" | "done" | "failed";
  error?: TicketApiError;
};

const INITIAL_FORM = {
  subject: "",
  description: "",
  priority: "normal" as TicketPriority,
  category: "support" as TicketCategory,
  dueDate: "",
  assignedTo: "",
};

const ALLOWED_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "csv",
  "xls",
  "xlsx",
  "zip",
  "docx",
  "txt",
];
function fileExtension(file: File) {
  return file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
}

function megabytes(bytes: number) {
  return Math.round(bytes / 1024 / 1024);
}

function validateFiles(files: File[], limits: TicketAttachmentLimits) {
  if (files.length > limits.maxFiles) {
    return `Selecione no máximo ${limits.maxFiles} arquivos.`;
  }
  if (files.some((file) => file.size > limits.maxFileBytes)) {
    return `Cada arquivo pode ter no máximo ${megabytes(limits.maxFileBytes)} MB.`;
  }
  if (
    files.reduce((total, file) => total + file.size, 0) >
    limits.maxTicketBytes
  ) {
    return `Os arquivos não podem ultrapassar ${megabytes(limits.maxTicketBytes)} MB no total.`;
  }
  if (files.some((file) => !ALLOWED_EXTENSIONS.includes(fileExtension(file)))) {
    return "Há um arquivo com tipo não permitido.";
  }
  return null;
}

function assigneeLabel(assignee: TicketPerson) {
  return assignee.name || assignee.email || `Usuário ${assignee.id}`;
}

export default function NewTicketPopover({
  open,
  organizationId,
  assignees,
  canManage,
  attachmentLimits,
  onClose,
  onCreated,
}: NewTicketPopoverProps) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [files, setFiles] = useState<File[]>([]);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const [createdTicket, setCreatedTicket] = useState<Ticket | null>(null);
  const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>(
    {},
  );
  const [phase, setPhase] = useState<
    "idle" | "creating" | "uploading" | "partial"
  >("idle");
  const [retryingFileKey, setRetryingFileKey] = useState<string | null>(null);
  const [error, setError] = useState<TicketApiError | string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);

  const busy =
    phase === "creating" || phase === "uploading" || retryingFileKey !== null;
  busyRef.current = busy;
  const totalBytes = useMemo(
    () => files.reduce((total, file) => total + file.size, 0),
    [files],
  );

  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (busyRef.current) abortControllerRef.current?.abort();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href]',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    }
  }, [open]);

  function resetAndClose() {
    abortControllerRef.current?.abort();
    setForm(INITIAL_FORM);
    setFiles([]);
    setFailedFiles([]);
    setCreatedTicket(null);
    setUploadStates({});
    setPhase("idle");
    setRetryingFileKey(null);
    setError(null);
    onClose();
  }

  async function uploadFiles(ticket: Ticket, queuedFiles: File[]) {
    if (queuedFiles.length === 0) {
      onCreated(ticket, []);
      resetAndClose();
      return;
    }

    setPhase("uploading");
    setError(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const failures: File[] = [];

    for (const file of queuedFiles) {
      if (controller.signal.aborted) break;
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      setUploadStates((current) => ({
        ...current,
        [key]: { progress: 0, status: "uploading" },
      }));

      try {
        await uploadTicketAttachment(organizationId, ticket.id, file, {
          signal: controller.signal,
          onProgress: (progress) =>
            setUploadStates((current) => ({
              ...current,
              [key]: {
                progress,
                status:
                  current[key]?.status === "finalizing"
                    ? "finalizing"
                    : "uploading",
              },
            })),
          onStage: (stage) =>
            setUploadStates((current) => ({
              ...current,
              [key]: {
                progress: current[key]?.progress || 0,
                status: stage,
              },
            })),
        });
        setUploadStates((current) => ({
          ...current,
          [key]: { progress: 100, status: "done" },
        }));
      } catch (uploadError) {
        if (
          uploadError instanceof DOMException &&
          uploadError.name === "AbortError"
        ) {
          break;
        }
        failures.push(file);
        setUploadStates((current) => ({
          ...current,
          [key]: {
            progress: current[key]?.progress || 0,
            status: "failed",
            error: toTicketApiError(uploadError, "Falha no envio."),
          },
        }));
      }
    }

    abortControllerRef.current = null;
    setFailedFiles(failures);
    onCreated(ticket, failures);

    if (failures.length > 0) {
      setPhase("partial");
      setError(
        `O chamado ${ticket.code} foi criado, mas ${failures.length} anexo(s) falharam.`,
      );
    } else {
      resetAndClose();
    }
  }

  async function retryFile(ticket: Ticket, file: File) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (retryingFileKey) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setRetryingFileKey(key);
    setUploadStates((current) => ({
      ...current,
      [key]: { progress: 0, status: "uploading" },
    }));

    try {
      await uploadTicketAttachment(organizationId, ticket.id, file, {
        signal: controller.signal,
        onProgress: (progress) =>
          setUploadStates((current) => ({
            ...current,
            [key]: {
              progress,
              status:
                current[key]?.status === "finalizing"
                  ? "finalizing"
                  : "uploading",
            },
          })),
        onStage: (stage) =>
          setUploadStates((current) => ({
            ...current,
            [key]: {
              progress: current[key]?.progress || 0,
              status: stage,
            },
          })),
      });
      setUploadStates((current) => ({
        ...current,
        [key]: { progress: 100, status: "done" },
      }));
      const remaining = failedFiles.filter((item) => item !== file);
      setFailedFiles(remaining);
      onCreated(ticket, remaining);
      if (remaining.length === 0) resetAndClose();
    } catch (uploadError) {
      if (!(uploadError instanceof DOMException && uploadError.name === "AbortError")) {
        setUploadStates((current) => ({
          ...current,
          [key]: {
            progress: current[key]?.progress || 0,
            status: "failed",
            error: toTicketApiError(uploadError, "Falha no envio."),
          },
        }));
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setRetryingFileKey(null);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || createdTicket) return;

    const fileError = validateFiles(files, attachmentLimits);
    if (fileError) {
      setError(fileError);
      return;
    }

    setPhase("creating");
    setError(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const payload: CreateTicketPayload = {
      subject: form.subject,
      description: form.description,
      priority: form.priority,
      category: form.category,
      dueAt: dateInputToIso(form.dueDate),
      assignedTo:
        canManage && form.assignedTo ? form.assignedTo : null,
    };

    try {
      const ticket = await createTicket(
        organizationId,
        payload,
        controller.signal,
      );
      setCreatedTicket(ticket);
      await uploadFiles(ticket, files);
    } catch (requestError) {
      if (
        requestError instanceof DOMException &&
        requestError.name === "AbortError"
      ) {
        return;
      }
      setPhase("idle");
      setError(
        toTicketApiError(requestError, "Não foi possível criar o chamado."),
      );
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }

  if (!open) return null;

  return (
    <div
      className="ticket-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) resetAndClose();
      }}
    >
      <div
        ref={panelRef}
        className="ticket-new-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-ticket-title"
        aria-describedby="new-ticket-description"
      >
        <header className="ticket-panel-header">
          <div>
            <span className="ticket-center-eyebrow">Nova solicitação</span>
            <h3 id="new-ticket-title">Novo chamado</h3>
            <p id="new-ticket-description">
              Registre o contexto primeiro; os anexos serão enviados em seguida.
            </p>
          </div>
          <button
            type="button"
            className="ticket-icon-button"
            aria-label="Fechar painel"
            onClick={resetAndClose}
          >
            ×
          </button>
        </header>

        {createdTicket && phase === "partial" ? (
          <section className="ticket-partial-upload" role="status">
            <strong>{createdTicket.code} foi criado.</strong>
            {error ? <TicketErrorNotice error={error} compact /> : null}
            <ul className="ticket-partial-files" aria-label="Anexos com falha">
              {failedFiles.map((file) => {
                const key = `${file.name}:${file.size}:${file.lastModified}`;
                const fileError = uploadStates[key]?.error;
                return (
                  <li key={key}>
                    <span>
                      <strong>{file.name}</strong>
                      <small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>
                    </span>
                    {fileError ? (
                      <TicketErrorNotice error={fileError} compact />
                    ) : null}
                    <button
                      type="button"
                      className="ticket-secondary-action"
                      disabled={retryingFileKey !== null}
                      onClick={() => void retryFile(createdTicket, file)}
                    >
                      {retryingFileKey === key
                        ? uploadStates[key]?.status === "finalizing"
                          ? "Finalizando..."
                          : `${uploadStates[key]?.progress || 0}%`
                        : "Tentar novamente este arquivo"}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="ticket-panel-actions">
              <button
                type="button"
                className="ticket-secondary-action"
                onClick={() => void uploadFiles(createdTicket, failedFiles)}
              >
                Tentar anexar novamente
              </button>
              <button
                type="button"
                className="ticket-primary-action"
                onClick={resetAndClose}
              >
                Concluir sem anexos
              </button>
            </div>
          </section>
        ) : (
          <form className="ticket-new-form" onSubmit={handleSubmit}>
            <label className="ticket-field ticket-field-wide">
              <span>Assunto *</span>
              <input
                autoComplete="off"
                required
                maxLength={160}
                value={form.subject}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    subject: event.target.value,
                  }))
                }
              />
              <small>{form.subject.length}/160</small>
            </label>

            <label className="ticket-field ticket-field-wide">
              <span>Descrição *</span>
              <textarea
                required
                maxLength={5000}
                rows={6}
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
              <small>{form.description.length}/5.000</small>
            </label>

            <label className="ticket-field">
              <span>Prioridade *</span>
              <select
                value={form.priority}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    priority: event.target.value as TicketPriority,
                  }))
                }
              >
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="ticket-field">
              <span>Categoria</span>
              <select
                value={form.category}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    category: event.target.value as TicketCategory,
                  }))
                }
              >
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="ticket-field">
              <span>Prazo</span>
              <input
                type="date"
                value={form.dueDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    dueDate: event.target.value,
                  }))
                }
              />
            </label>

            {canManage ? (
              <label className="ticket-field">
                <span>Atendente</span>
                <select
                  value={form.assignedTo}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      assignedTo: event.target.value,
                    }))
                  }
                >
                  <option value="">Não atribuído</option>
                  {assignees.map((assignee) => (
                    <option key={assignee.id} value={String(assignee.id)}>
                      {assigneeLabel(assignee)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="ticket-file-picker ticket-field-wide">
              <input
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xls,.xlsx,.zip,.docx,.txt"
                onChange={(event) => {
                  const nextFiles = Array.from(event.target.files || []);
                  setFiles(nextFiles);
                  setUploadStates({});
                  setError(validateFiles(nextFiles, attachmentLimits));
                }}
              />
              <span aria-hidden="true">⇧</span>
              <strong>Adicionar anexos</strong>
              <small>
                Até {attachmentLimits.maxFiles} arquivos ·{" "}
                {megabytes(attachmentLimits.maxFileBytes)} MB cada ·{" "}
                {megabytes(attachmentLimits.maxTicketBytes)} MB no total
              </small>
            </label>

            {files.length > 0 ? (
              <ul className="ticket-upload-queue" aria-label="Arquivos selecionados">
                {files.map((file) => {
                  const key = `${file.name}:${file.size}:${file.lastModified}`;
                  const state = uploadStates[key];
                  return (
                    <li key={key}>
                      <div>
                        <strong>{file.name}</strong>
                        <small>{(file.size / 1024 / 1024).toFixed(2)} MB</small>
                      </div>
                      <div className="ticket-upload-progress">
                        <span style={{ width: `${state?.progress || 0}%` }} />
                      </div>
                      <small>
                        {state?.status === "failed"
                          ? state.error?.message
                          : state?.status === "done"
                            ? "Concluído"
                            : state?.status === "finalizing"
                              ? "Finalizando anexo..."
                            : state?.status === "uploading"
                              ? `${state.progress}%`
                              : "Na fila"}
                      </small>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            <div className="ticket-form-summary ticket-field-wide">
              <span>{files.length} arquivo(s)</span>
              <span>{(totalBytes / 1024 / 1024).toFixed(2)} MB</span>
            </div>

            {error ? (
              <div className="ticket-field-wide">
                <TicketErrorNotice error={error} compact />
              </div>
            ) : null}

            <div className="ticket-panel-actions ticket-field-wide">
              <button
                type="button"
                className="ticket-secondary-action"
                onClick={resetAndClose}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="ticket-primary-action"
                disabled={busy || Boolean(error)}
              >
                {phase === "creating"
                  ? "Criando chamado..."
                  : phase === "uploading"
                    ? "Enviando anexos..."
                    : "Criar chamado"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
