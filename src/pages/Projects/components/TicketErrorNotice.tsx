import { useState } from "react";

import { normalizeUserError } from "../../../lib/user-error-catalog";
import { TicketApiError, toTicketApiError } from "./tickets-api";

type TicketErrorNoticeProps = {
  error: TicketApiError | Error | string;
  compact?: boolean;
  onRetry?: () => void;
};

function userMessage(error: TicketApiError) {
  if (error.status === 412) return "O chamado mudou desde sua última leitura. Seu rascunho foi preservado; confira a versão atual antes de tentar novamente.";
  if (error.status === 428) return "Atualize o chamado para obter os requisitos atuais desta ação. Seus dados não serão descartados.";
  if (error.status === 409 && error.code?.includes("IDEMPOTENCY")) return "Esta tentativa de criação já está em processamento ou possui dados diferentes. Repita a intenção original para verificar o resultado.";
  if (error.status === 409) return "A ação não pôde ser concluída no estado atual. Confira o chamado antes de decidir como continuar.";
  if (error.code === "TICKET_LIFECYCLE_DISABLED") return "O acompanhamento por etapas ainda não está disponível neste ambiente. Atualize o chamado.";
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
  return normalizeUserError(error).message;
}

export default function TicketErrorNotice({
  error,
  compact = false,
  onRetry,
}: TicketErrorNoticeProps) {
  const [copied, setCopied] = useState(false);
  const apiError = typeof error === "string" ? null : toTicketApiError(error);
  const presentation = apiError ? normalizeUserError(apiError) : null;
  const message = typeof error === "string" ? error : userMessage(apiError!);
  const supportReference = presentation?.supportReference;

  async function copyReference() {
    if (!supportReference) return;
    try {
      await navigator.clipboard.writeText(supportReference);
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
        {supportReference ? (
          <span className="ticket-error-reference">
            Referência: <code>{supportReference}</code>
          </span>
        ) : null}
      </div>
      <div className="ticket-error-actions">
        {supportReference ? (
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
