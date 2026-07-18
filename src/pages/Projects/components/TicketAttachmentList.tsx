import { useRef, useState } from "react";

import {
  deleteTicketAttachment,
  downloadTicketAttachment,
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
};

export default function TicketAttachmentList({
  organizationId,
  ticket,
  attachments,
  canUpload,
  canManage,
  attachmentLimits,
  currentUserId,
  onChanged,
}: TicketAttachmentListProps) {
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStage, setUploadStage] = useState<"uploading" | "finalizing">(
    "uploading",
  );
  const [busyAttachmentId, setBusyAttachmentId] = useState<string | null>(null);
  const [error, setError] = useState<TicketApiError | string | null>(null);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadControllerRef = useRef<AbortController | null>(null);

  const currentBytes = attachments.reduce(
    (total, attachment) => total + Number(attachment.size || 0),
    0,
  );
  const uploadAllowed =
    canUpload &&
    ticket.status !== "closed" &&
    attachments.length < attachmentLimits.maxFiles &&
    currentBytes < attachmentLimits.maxTicketBytes;

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
    if (currentBytes + file.size > attachmentLimits.maxTicketBytes) {
      setError(
        `Os anexos do chamado não podem ultrapassar ${formatFileSize(attachmentLimits.maxTicketBytes)}.`,
      );
      return;
    }
    setUploadProgress(0);
    setUploadStage("uploading");
    const controller = new AbortController();
    uploadControllerRef.current = controller;

    try {
      await uploadTicketAttachment(organizationId, ticket.id, file, {
        signal: controller.signal,
        onProgress: setUploadProgress,
        onStage: setUploadStage,
      });
      onChanged();
    } catch (requestError) {
      if (
        requestError instanceof DOMException &&
        requestError.name === "AbortError"
      ) {
        setError("Upload cancelado.");
      } else {
        setFailedFile(file);
        setError(
          toTicketApiError(requestError, "Não foi possível enviar o anexo."),
        );
      }
    } finally {
      uploadControllerRef.current = null;
      setUploadProgress(null);
      if (inputRef.current) inputRef.current.value = "";
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
            {formatFileSize(currentBytes)} /{" "}
            {formatFileSize(attachmentLimits.maxTicketBytes)} ·{" "}
            {attachments.length}/{attachmentLimits.maxFiles} arquivos ·{" "}
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

      {uploadProgress !== null ? (
        <div className="ticket-detail-upload" role="status">
          <div>
            <span style={{ width: `${uploadProgress}%` }} />
          </div>
          <span>
            {uploadStage === "finalizing"
              ? "Finalizando anexo..."
              : `${uploadProgress}%`}
          </span>
          <button
            type="button"
            onClick={() => uploadControllerRef.current?.abort()}
          >
            Cancelar
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

      {ticket.status === "closed" ? (
        <p className="ticket-upload-locked">
          Chamados concluídos preservam os anexos existentes, mas não aceitam novos envios.
        </p>
      ) : null}

      {attachments.length === 0 ? (
        <div className="ticket-attachments-empty">
          Nenhum arquivo anexado a este chamado.
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
