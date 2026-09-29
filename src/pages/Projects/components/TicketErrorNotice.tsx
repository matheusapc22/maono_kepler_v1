import { useState } from "react";

import { normalizeUserError } from "../../../lib/user-error-catalog";
import { TicketApiError, toTicketApiError } from "./tickets-api";

type TicketErrorNoticeProps = {
  error: TicketApiError | Error | string;
  compact?: boolean;
  onRetry?: () => void;
};

function userMessage(error: TicketApiError) {
  if (error.code === "TICKET_FEEDBACK_EXPIRED") return "O prazo desta pesquisa terminou. O chamado permanece disponível para conversa ou reabertura.";
  if (error.code === "TICKET_FEEDBACK_ALREADY_RESPONDED") return "Este convite já tem uma resposta. Atualize para consultar o recibo.";
  if (error.code === "TICKET_FEEDBACK_INVALID_INSTRUMENT") return "Confira as perguntas, categorias, escala, prazo, consentimento e aprovação do instrumento.";
  if (error.code === "TICKET_FEEDBACK_INVALID_RESPONSE") return "Confira resultado, esforço, consentimento e o comentário de até 2.000 caracteres.";
  if (error.code === "TICKET_FEEDBACK_METRICS_LIMIT") return "A consulta excede o limite de 2.000 convites. Nenhum resultado parcial foi apresentado.";

  if (error.code === "TICKET_METRICS_LIMIT") return "O universo excede o limite desta consulta. Nenhum chamado foi descartado; solicite um relatório assíncrono quando disponível.";
  if (error.code === "TICKET_METRICS_ACCESS_CHANGED") return "O acesso mudou durante a consulta. Atualize os indicadores.";
  if (error.code === "TICKET_METRICS_CONFLICT") return "A configuração ou a reconstrução mudou. Atualize antes de tentar novamente.";
  if (error.code === "TICKET_METRICS_NOT_READY" || error.code === "TICKET_METRICS_DISABLED") return "As métricas ainda aguardam preparação nesta organização.";
  if (error.code === "TICKET_METRICS_INVALID") return "Confira as datas, a janela aprovada e a justificativa.";
  if (error.code === "TICKET_SLA_HISTORY_LIMIT") return "Este histórico precisa de revisão para calcular o SLA. Nenhum período foi descartado.";
  if (error.code === "TICKET_SLA_VERSION_CONFLICT") return "A política ou o ciclo mudou. Atualize o SLA e confira os dados antes de tentar novamente.";
  if (error.code === "TICKET_SLA_NOT_READY" || error.code === "TICKET_SLA_DISABLED") return "O SLA ainda não está disponível nesta organização.";
  if (error.code === "TICKET_SLA_INVALID") return "Confira metas, datas, fuso, expediente, atendentes e justificativa. O calendário deve cobrir o período e seus intervalos não podem se sobrepor.";
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
