import {
  apiErrorDiagnostic,
  type ApiErrorDiagnostic,
  type ErrorCategory,
} from "./error-contract.ts";

export type UserErrorSeverity = "info" | "warning" | "error";
export type UserErrorAction =
  | "retry"
  | "login"
  | "reload"
  | "contact_support";

export type UserErrorPresentation = {
  title: string;
  message: string;
  retryable: boolean;
  severity: UserErrorSeverity;
  action?: UserErrorAction;
  supportReference?: string;
};

type UserErrorTemplate = Omit<
  UserErrorPresentation,
  "retryable" | "supportReference"
> & {
  retryable?: boolean;
};

const INVALID_CREDENTIALS_PRESENTATION: UserErrorTemplate = {
  title: "Não foi possível entrar",
  message: "E-mail ou senha incorretos.",
  severity: "warning",
};

const CODE_PRESENTATIONS: Record<string, UserErrorTemplate> = {
  AUTH_INVALID_CREDENTIALS: INVALID_CREDENTIALS_PRESENTATION,

  // Compatibilidade temporária com deploys anteriores à PRH-02A.
  INVALID_CREDENTIALS: INVALID_CREDENTIALS_PRESENTATION,

  AUTH_LOGIN_TIMEOUT: {
    title: "Não foi possível entrar",
    message: "A conexão demorou mais que o esperado. Tente entrar novamente.",
    severity: "warning",
    retryable: true,
    action: "retry",
  },
  AUTH_SESSION_REQUIRED: {
    title: "Sessão necessária",
    message: "Entre novamente para continuar.",
    severity: "warning",
    action: "login",
  },
  AUTH_SESSION_EXPIRED: {
    title: "Sua sessão expirou",
    message: "Entre novamente para continuar.",
    severity: "warning",
    action: "login",
  },
  UNAUTHORIZED: {
    title: "Sua sessão expirou",
    message: "Entre novamente para continuar.",
    severity: "warning",
    action: "login",
  },
  FORBIDDEN: {
    title: "Ação não permitida",
    message: "Você não possui permissão para realizar esta ação.",
    severity: "warning",
  },
  PERMISSION_DENIED: {
    title: "Ação não permitida",
    message: "Você não possui permissão para realizar esta ação.",
    severity: "warning",
  },
  ORGANIZATION_ACCESS_DENIED: {
    title: "Ação não permitida",
    message: "Você não possui acesso a esta organização.",
    severity: "warning",
  },
  ORGANIZATION_NOT_FOUND: {
    title: "Organização indisponível",
    message: "A organização selecionada não está disponível.",
    severity: "warning",
  },
  ORGANIZATION_INACTIVE: {
    title: "Organização indisponível",
    message: "A organização selecionada está inativa.",
    severity: "warning",
  },
  PERMISSION_PROJECT_SAVE_DENIED: {
    title: "Não foi possível salvar",
    message: "Você não possui permissão para salvar alterações neste projeto.",
    severity: "warning",
  },
  PROJECT_NOT_FOUND: {
    title: "Projeto indisponível",
    message: "O projeto não foi encontrado ou não está disponível para este usuário.",
    severity: "warning",
  },
  PROJECT_CONFIG_REVISION_CONFLICT: {
    title: "O projeto foi atualizado",
    message: "Recarregue o mapa antes de salvar novamente.",
    severity: "warning",
    action: "reload",
  },
  PROJECT_METADATA_VERSION_CONFLICT: {
    title: "O projeto foi atualizado",
    message: "Carregue a versão atual antes de salvar novamente.",
    severity: "warning",
  },
  DOCUMENT_UPLOAD_ABORTED: {
    title: "Envio cancelado",
    message: "O envio do documento foi cancelado.",
    severity: "info",
  },
  DOCUMENT_DOWNLOAD_ABORTED: {
    title: "Download cancelado",
    message: "O download do documento foi cancelado.",
    severity: "info",
  },
  PERFORMANCE_PAYLOAD_TOO_LARGE: {
    title: "Limite excedido",
    message: "Os dados enviados excedem o limite permitido para esta operação.",
    severity: "warning",
  },
  PERFORMANCE_OPERATION_TIMEOUT: {
    title: "A operação demorou além do esperado",
    message: "Tente novamente em alguns instantes.",
    severity: "warning",
    retryable: true,
    action: "retry",
  },
  DROPBOX_RATE_LIMITED: {
    title: "Serviço temporariamente ocupado",
    message: "Aguarde alguns instantes e tente novamente.",
    severity: "warning",
    retryable: true,
    action: "retry",
  },
  INFRASTRUCTURE_NETWORK_FAILURE: {
    title: "Não foi possível conectar",
    message: "Verifique sua conexão e tente novamente.",
    severity: "warning",
    retryable: true,
    action: "retry",
  },
};

const CATEGORY_PRESENTATIONS: Record<ErrorCategory, UserErrorTemplate> = {
  AUTH: {
    title: "Não foi possível confirmar sua sessão",
    message: "Entre novamente e repita a operação.",
    severity: "warning",
    action: "login",
  },
  PERMISSION: {
    title: "Ação não permitida",
    message: "Você não possui permissão para realizar esta ação.",
    severity: "warning",
  },
  PROJECT: {
    title: "Não foi possível acessar o projeto",
    message: "Atualize a página e tente novamente.",
    severity: "warning",
  },
  MAP_CONFIG: {
    title: "Não foi possível atualizar o mapa",
    message: "Recarregue o projeto e tente novamente.",
    severity: "warning",
    action: "reload",
  },
  STORAGE: {
    title: "Recurso temporariamente indisponível",
    message: "Tente novamente em alguns instantes.",
    severity: "warning",
    action: "retry",
  },
  PERFORMANCE: {
    title: "Operação não concluída",
    message: "Revise os dados e tente novamente.",
    severity: "warning",
  },
  SPATIAL: {
    title: "Não foi possível concluir a análise",
    message: "Revise os dados geográficos e tente novamente.",
    severity: "warning",
  },
  ENGINE: {
    title: "Não foi possível processar o mapa",
    message: "Tente novamente em alguns instantes.",
    severity: "error",
    action: "retry",
  },
  INFRASTRUCTURE: {
    title: "Não foi possível concluir esta ação",
    message: "Tente novamente em alguns instantes.",
    severity: "error",
    action: "retry",
  },
};

const FALLBACK_PRESENTATION: UserErrorTemplate = {
  title: "Não foi possível concluir esta ação",
  message: "Tente novamente. Se o problema continuar, procure o suporte.",
  severity: "error",
};

function stableReference(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `MNO-${(hash >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

export function formatSupportReference(value?: string | null) {
  const normalized = String(value || "").trim();
  return normalized ? stableReference(normalized) : undefined;
}

function statusPresentation(status: number): UserErrorTemplate | null {
  if (status === 401) return CODE_PRESENTATIONS.AUTH_SESSION_EXPIRED;
  if (status === 403) return CODE_PRESENTATIONS.PERMISSION_DENIED;
  if (status === 404) {
    return {
      title: "Recurso não encontrado",
      message: "O conteúdo solicitado não está disponível.",
      severity: "warning",
    };
  }
  if (status === 409) {
    return {
      title: "A operação precisa ser atualizada",
      message: "Atualize a página e tente novamente.",
      severity: "warning",
      action: "reload",
    };
  }
  if (status === 429) {
    return {
      title: "Muitas solicitações em sequência",
      message: "Aguarde alguns instantes e tente novamente.",
      severity: "warning",
      retryable: true,
      action: "retry",
    };
  }
  return null;
}

function presentationForDiagnostic(
  diagnostic: ApiErrorDiagnostic | null,
): UserErrorTemplate {
  if (!diagnostic) return FALLBACK_PRESENTATION;

  if (diagnostic.code && CODE_PRESENTATIONS[diagnostic.code]) {
    return CODE_PRESENTATIONS[diagnostic.code];
  }

  const byStatus = statusPresentation(diagnostic.status);
  if (byStatus) return byStatus;

  if (diagnostic.category) {
    return CATEGORY_PRESENTATIONS[diagnostic.category];
  }

  return FALLBACK_PRESENTATION;
}

export function normalizeUserError(error: unknown): UserErrorPresentation {
  const diagnostic = apiErrorDiagnostic(error);
  const template = presentationForDiagnostic(diagnostic);
  const retryable = template.retryable ?? diagnostic?.retryable ?? false;
  const supportReference =
    diagnostic &&
    (diagnostic.status >= 500 ||
      diagnostic.category === "INFRASTRUCTURE" ||
      diagnostic.category === "STORAGE" ||
      diagnostic.category === "ENGINE")
      ? formatSupportReference(diagnostic.correlationId)
      : undefined;

  const action =
    template.action ??
    (retryable ? "retry" : supportReference ? "contact_support" : undefined);

  return {
    title: template.title,
    message: template.message,
    retryable,
    severity: template.severity,
    ...(action ? { action } : {}),
    ...(supportReference ? { supportReference } : {}),
  };
}
