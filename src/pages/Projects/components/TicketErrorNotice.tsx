import { useState } from "react";

import { TicketApiError, toTicketApiError } from "./tickets-api";

type TicketErrorNoticeProps = {
  error: TicketApiError | Error | string;
  compact?: boolean;
  onRetry?: () => void;
};

function userMessage(error: TicketApiError) {
  if (error.code === "TICKET_CENTER_SCHEMA_OUTDATED") {
    return "A Central ainda não está disponível neste ambiente.";
  }
  if (error.status === 401 || error.status === 403) {
    return "Você não possui permissão para esta ação.";
  }
  if (error.code?.includes("LIMIT") || error.status === 413) {
    return "O arquivo ou o total de anexos ultrapassa o limite permitido.";
  }
  if (
    error.code?.includes("TYPE") ||
    error.code?.includes("MIME") ||
    error.code?.includes("SIGNATURE")
  ) {
    return "O formato ou o conteúdo do arquivo não é aceito.";
  }
  if (
    error.code?.includes("DROPBOX") ||
    error.code === "TICKET_UPLOAD_NETWORK_ERROR"
  ) {
    return "O envio foi interrompido. Tente novamente este arquivo.";
  }
  if ((error.status || 0) >= 500) {
    return "Não foi possível concluir. Informe a referência exibida ao suporte.";
  }
  return error.message;
}

export default function TicketErrorNotice({
  error,
  compact = false,
  onRetry,
}: TicketErrorNoticeProps) {
  const [copied, setCopied] = useState(false);
  const apiError =
    typeof error === "string"
      ? new TicketApiError(error)
      : toTicketApiError(error);
  const message = userMessage(apiError);

  async function copyReference() {
    if (!apiError.requestId) return;
    try {
      await navigator.clipboard.writeText(apiError.requestId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Ambientes sem Clipboard API ainda mantêm a referência selecionável.
    }
  }

  return (
    <div
      className={compact ? "ticket-error-notice is-compact" : "ticket-error-notice"}
      role="alert"
    >
      <div>
        <strong>{message}</strong>
        {apiError.message !== message ? (
          <span>{apiError.message}</span>
        ) : null}
        {apiError.requestId ? (
          <span className="ticket-error-reference">
            Referência: <code>{apiError.requestId}</code>
          </span>
        ) : null}
      </div>
      <div className="ticket-error-actions">
        {apiError.requestId ? (
          <button type="button" onClick={() => void copyReference()}>
            {copied ? "Referência copiada" : "Copiar referência"}
          </button>
        ) : null}
        {onRetry ? (
          <button type="button" onClick={onRetry}>
            Tentar novamente
          </button>
        ) : null}
      </div>
    </div>
  );
}
