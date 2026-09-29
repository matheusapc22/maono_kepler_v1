import "./ticket-accessibility.css";
import { useEffect, useRef, useState } from "react";

import {
  cancelTicketAttachmentUpload,
  deleteTicketAttachment,
  downloadTicketAttachment,
  listTicketAttachmentUploadSessions,
  resumeTicketAttachmentUpload,
  TicketApiError,
  toTicketApiError,
  uploadTicketAttachment,
} from "./tickets-api";
import TicketErrorNotice from "./TicketErrorNotice";
import {
  formatFileSize,
  formatTicketDateTime,
  ticketPersonName,
} from "./ticket-format";
import type {
  Ticket,
  TicketAttachment,
  TicketAttachmentLimits,
  TicketAttachmentUploadSession,
} from "./ticket-types";

type TicketAttachmentListProps = {
  organizationId: number | string;
  ticket: Ticket;
  attachments: TicketAttachment[];
  canUpload: boolean;
  canManage: boolean;
  attachmentLimits: TicketAttachmentLimits;
  currentUserId?: number | string | null;
  onChanged: () => void;
  onBusyChange?: (busy: boolean) => void;
};

type UploadStage = "hashing" | "resuming" | "uploading" | "finalizing";

function phaseLabel(phase: UploadStage, progress: number) {
  if (phase === "hashing") return "Verificando arquivo...";
  if (phase === "resuming") return "Reconectando ao envio...";
  if (phase === "finalizing") return "Finalizando e verificando anexo...";
  return `${progress}%`;
}

export default function TicketAttachmentList({
  organizationId,
  ticket,
  attachments,
  canUpload,
  canManage,
  attachmentLimits,
  currentUserId,
  onChanged,
  onBusyChange,
}: TicketAttachmentListProps) {
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStage, setUploadStage] = useState<UploadStage>("uploading");
  const [busyAttachmentId, setBusyAttachmentId] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState<TicketAttachmentUploadSession[]>([]);
  const [error, setError] = useState<TicketApiError | string | null>(null);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  useEffect(() => { onBusyChange?.(uploadProgress !== null || busySessionId !== null); }, [uploadProgress, busySessionId, onBusyChange]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => { uploadControllerRef.current?.abort(); uploadControllerRef.current = null; }, []);

  async function refreshPendingUploads(signal?: AbortSignal) {
    if (!canUpload || ticket.status === "closed") {
      setPendingUploads([]);
      return [];
    }
    try {
      const sessions = await listTicketAttachmentUploadSessions(
        organizationId,
        ticket.id,
        signal,
      );
      setPendingUploads(sessions.filter((session) => !session.draftId));
      return sessions;
    } catch (requestError) {
      if (signal?.aborted) return [];
      const apiError = toTicketApiError(requestError);
      if ([403, 404, 503].includes(Number(apiError.status || 0))) {
        setPendingUploads([]);
        return [];
      }
      setError(apiError);
      return [];
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void refreshPendingUploads(controller.signal);
    return () => controller.abort();
  }, [organizationId, ticket.id, ticket.status, canUpload]);

  const currentBytes = attachments.reduce(
    (total, attachment) => total + Number(attachment.size || 0),
    0,
  );
  const reservedBytes = pendingUploads.reduce(
    (total, session) => total + Number(session.size || 0),
    0,
  );
  const usedBytes = currentBytes + reservedBytes;
  const usedFiles = attachments.length + pendingUploads.length;
  const uploadAllowed =
    canUpload &&
    ticket.status !== "closed" &&
    usedFiles < attachmentLimits.maxFiles &&
    usedBytes < attachmentLimits.maxTicketBytes;

  async function handleUpload(file: File) {
    if (!uploadAllowed) return;
    setError(null);
    setFailedFile(null);
    if (file.size > attachmentLimits.maxFileBytes) {
      setError(
        `Cada arquivo pode ter no máximo ${formatFileSize(attachmentLimits.maxFileBytes)}.`,
      );
      return;
    }
    if (usedBytes + file.size > attachmentLimits.maxTicketBytes) {
      setError(
        `Os anexos do chamado não podem ultrapassar ${formatFileSize(attachmentLimits.maxTicketBytes)}.`,
      );
      return;
    }
    setUploadProgress(0);
    setUploadStage("hashing");
    const controller = new AbortController();
    uploadControllerRef.current = controller;

    try {
      await uploadTicketAttachment(organizationId, ticket.id, file, {
        signal: controller.signal,
        onProgress: setUploadProgress,
        onPhase: setUploadStage,
      });
      await refreshPendingUploads();
      onChanged();
    } catch (requestError) {
      if (
        requestError instanceof DOMException &&
        requestError.name === "AbortError"
      ) {
        setError("Envio pausado. Se a sessão foi criada, você poderá retomá-la abaixo.");
      } else {
        const sessions = await refreshPendingUploads();
        const resumable = sessions.find(
          (session) =>
            !session.draftId &&
            session.name === file.name &&
            Number(session.size) === Number(file.size),
        );
        if (resumable) {
          setFailedFile(null);
          setError("O envio foi interrompido, mas a sessão foi preservada. Selecione o mesmo arquivo em Retomar.");
        } else {
          setFailedFile(file);
          setError(
            toTicketApiError(requestError, "Não foi possível enviar o anexo."),
          );
        }
      }
    } finally {
      uploadControllerRef.current = null;
      setUploadProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleResume(session: TicketAttachmentUploadSession, file: File) {
    setBusySessionId(session.id);
    setError(null);
    setFailedFile(null);
    setUploadProgress(Math.round((session.offset / Math.max(1, session.size)) * 100));
    setUploadStage("hashing");
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    try {
      await resumeTicketAttachmentUpload(organizationId, ticket.id, session, file, {
        signal: controller.signal,
        onProgress: setUploadProgress,
        onPhase: setUploadStage,
      });
      await refreshPendingUploads();
      onChanged();
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        setError("Retomada pausada. A sessão continua preservada no servidor.");
      } else {
        setError(toTicketApiError(requestError, "Não foi possível retomar o envio."));
      }
      await refreshPendingUploads();
    } finally {
      uploadControllerRef.current = null;
      setUploadProgress(null);
      setBusySessionId(null);
    }
  }

  async function handleCancelSession(session: TicketAttachmentUploadSession) {
    setBusySessionId(session.id);
    setError(null);
    try {
      await cancelTicketAttachmentUpload(organizationId, ticket.id, session.id);
      await refreshPendingUploads();
      onChanged();
    } catch (requestError) {
      setError(toTicketApiError(requestError, "Não foi possível cancelar o envio."));
    } finally {
      setBusySessionId(null);
    }
  }

  async function handleDownload(attachment: TicketAttachment) {
    setBusyAttachmentId(String(attachment.id));
    setError(null);
    try {
      await downloadTicketAttachment(
        organizationId,
        ticket.id,
        attachment,
      );
    } catch (requestError) {
      setError(
        toTicketApiError(requestError, "Não foi possível baixar o anexo."),
      );
    } finally {
      setBusyAttachmentId(null);
    }
  }

  async function handleDelete(attachment: TicketAttachment) {
    setBusyAttachmentId(String(attachment.id));
    setError(null);
    try {
      await deleteTicketAttachment(
        organizationId,
        ticket.id,
        attachment.id,
      );
      onChanged();
    } catch (requestError) {
      setError(
        toTicketApiError(requestError, "Não foi possível excluir o anexo."),
      );
    } finally {
      setBusyAttachmentId(null);
    }
  }

  return (
    <section className="ticket-attachments" aria-labelledby="ticket-attachments-title">
      <header>
        <div>
          <h4 id="ticket-attachments-title">Anexos</h4>
          <p>
            {formatFileSize(usedBytes)} /{" "}
            {formatFileSize(attachmentLimits.maxTicketBytes)} ·{" "}
            {usedFiles}/{attachmentLimits.maxFiles} arquivos/reservas ·{" "}
            {formatFileSize(attachmentLimits.maxFileBytes)} por arquivo
          </p>
        </div>

        {uploadAllowed ? (
          <label className="ticket-attachment-upload">
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xls,.xlsx,.zip,.docx,.txt"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleUpload(file);
              }}
            />
            Adicionar arquivo
          </label>
        ) : null}
      </header>

      <p>Ao trocar de organização, o envio neste navegador é interrompido. Confira ou retome a sessão na organização de origem.</p>
      <p role="status">{uploadProgress !== null ? (uploadStage === "uploading" ? "Enviando arquivo." : phaseLabel(uploadStage, 0)) : ""}</p>
      {uploadProgress !== null ? (
        <div className="ticket-detail-upload">
          <div>
            <span role="progressbar" aria-label="Envio de anexo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress} style={{ width: `${uploadProgress}%` }} />
          </div>
          <span>{phaseLabel(uploadStage, uploadProgress)}</span>
          <button
            type="button"
            onClick={() => uploadControllerRef.current?.abort()}
          >
            Pausar
          </button>
        </div>
      ) : null}

      {error ? (
        <TicketErrorNotice
          error={error}
          compact
          onRetry={failedFile ? () => void handleUpload(failedFile) : undefined}
        />
      ) : null}

      {pendingUploads.length > 0 ? (
        <div className="ticket-upload-resume-list" aria-label="Envios pendentes">
          <strong>Envios que podem ser retomados</strong>
          <ul>
            {pendingUploads.map((session) => {
              const busy = busySessionId === session.id;
              const progress = Math.round((session.offset / Math.max(1, session.size)) * 100);
              return (
                <li key={session.id}>
                  <div>
                    <strong>{session.name}</strong>
                    <small>
                      {progress}% · {formatFileSize(session.offset)} de {formatFileSize(session.size)} · expira {formatTicketDateTime(session.expiresAt)}
                    </small>
                  </div>
                  <div>
                    <label className="ticket-attachment-upload">
                      <input
                        type="file"
                        disabled={busy}
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.xls,.xlsx,.zip,.docx,.txt"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void handleResume(session, file);
                          event.currentTarget.value = "";
                        }}
                      />
                      Retomar
                    </label>
                    <button
                      type="button"
                      className="ticket-danger-action"
                      disabled={busy}
                      onClick={() => void handleCancelSession(session)}
                    >
                      Cancelar envio
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {ticket.status === "closed" ? (
        <p className="ticket-upload-locked">
          Chamados concluídos preservam os anexos existentes, mas não aceitam novos envios.
        </p>
      ) : null}

      {attachments.length === 0 ? (
        <div className="ticket-attachments-empty">
          Nenhum arquivo concluído neste chamado.
        </div>
      ) : (
        <ul>
          {attachments.map((attachment) => {
            const busy = busyAttachmentId === String(attachment.id);
            const isCreator =
              currentUserId !== null &&
              currentUserId !== undefined &&
              String(attachment.uploadedBy?.id) === String(currentUserId);
            const canDelete =
              canManage || (isCreator && ticket.status !== "closed");

            return (
              <li key={attachment.id}>
                <span className="ticket-attachment-icon" aria-hidden="true">
                  ▣
                </span>
                <div>
                  <strong>{attachment.name}</strong>
                  <small>
                    {formatFileSize(attachment.size)} · enviado por{" "}
                    {ticketPersonName(attachment.uploadedBy)} ·{" "}
                    {formatTicketDateTime(attachment.createdAt)}
                  </small>
                </div>
                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDownload(attachment)}
                  >
                    Baixar
                  </button>
                  {canDelete ? (
                    <button
                      type="button"
                      className="ticket-danger-action"
                      disabled={busy}
                      onClick={() => void handleDelete(attachment)}
                    >
                      Excluir
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
