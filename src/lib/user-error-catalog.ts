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

const STORAGE_WAIT_PRESENTATION: UserErrorTemplate = {
  title: "Armazenamento temporariamente indisponível",
  message: "Não foi possível concluir esta ação agora. Aguarde alguns instantes antes de tentar novamente.",
  severity: "warning",
  retryable: true,
  action: "retry",
};

const STORAGE_BLOCKED_PRESENTATION: UserErrorTemplate = {
  title: "Armazenamento indisponível",
  message: "O armazenamento desta organização precisa de verificação. Procure o suporte para continuar.",
  severity: "warning",
  retryable: false,
  action: "contact_support",
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
  ORGANIZATION_STORAGE_IN_PROGRESS: {
    title: "Preparando armazenamento",
    message: "O armazenamento desta organização está sendo preparado. Aguarde alguns instantes antes de tentar novamente.",
    severity: "info",
    retryable: true,
    action: "retry",
  },
  ORGANIZATION_STORAGE_DISABLED: {
    title: "Organização indisponível",
    message: "Esta organização não está disponível para esta operação. Se precisar de ajuda, procure o suporte.",
    severity: "warning",
    retryable: false,
    action: "contact_support",
  },
  ORGANIZATION_STORAGE_PATH_DECISION_REQUIRED: STORAGE_BLOCKED_PRESENTATION,
  ORGANIZATION_STORAGE_RETRY_EXHAUSTED: STORAGE_BLOCKED_PRESENTATION,
  ORGANIZATION_STORAGE_RETRY_BLOCKED: STORAGE_BLOCKED_PRESENTATION,
  ORGANIZATION_STORAGE_SCHEMA_OUTDATED: STORAGE_BLOCKED_PRESENTATION,
  ORGANIZATION_STORAGE_RETRY_BACKOFF: STORAGE_WAIT_PRESENTATION,
  ORGANIZATION_CONCURRENT_UPDATE: {
    title: "A organização foi atualizada",
    message: "Carregue os dados atuais da organização antes de salvar novamente.",
    severity: "warning",
    retryable: false,
    action: "reload",
  },
  ORGANIZATION_EXISTS: {
    title: "Organização já cadastrada",
    message: "Já existe uma organização com este identificador. Confira a lista de organizações antes de tentar criar novamente.",
    severity: "warning",
    retryable: false,
  },
  PERMISSION_PROJECT_SAVE_DENIED: {
    title: "Não foi possível salvar",
    message: "Você não possui permissão para salvar alterações neste projeto.",
    severity: "warning",
  },
  // Durable saves expose only these stable, local messages, never Error.message.
  LOCAL_SAVE_STORAGE_UNAVAILABLE: {
    title: "Recuperação local indisponível",
    message: "A recuperação local não está disponível neste navegador. Exporte o mapa antes de fechar ou recarregar. A recuperação local não está garantida.",
    severity: "warning",
    retryable: false,
  },
  LOCAL_SAVE_QUOTA_EXCEEDED: {
    title: "Sem espaço para recuperar a tentativa",
    message: "Não há espaço no navegador para preservar esta tentativa. Exporte o mapa antes de fechar ou recarregar. A recuperação local não está garantida.",
    severity: "warning",
    retryable: false,
  },
  LOCAL_SAVE_CORRUPTED: {
    title: "A cópia local precisa de revisão",
    message: "A cópia local desta tentativa está inválida. Exporte o rascunho atual antes de fechar ou recarregar; o conteúdo inválido não será enviado.",
    severity: "warning",
    retryable: false,
  },
  LOCAL_SAVE_CREATION_PAYLOAD_UNAVAILABLE: {
    title: "A tentativa de criação precisa de revisão",
    message: "A cópia local desta tentativa expirou ou foi removida. Nenhuma nova reserva foi iniciada. Exporte o rascunho atual e revise a tentativa antes de criar o projeto novamente.",
    severity: "warning",
    retryable: false,
  },
  SAVE_RECEIPT_UNVERIFIED: {
    title: "Salvamento ainda não confirmado",
    message: "Não foi possível verificar a confirmação desta tentativa. Sua cópia foi preservada; verifique a mesma tentativa novamente.",
    severity: "warning",
    retryable: false,
  },
  SAVE_CREATION_ACTIVE_UNCONFIRMED: {
    title: "Criação ainda não confirmada",
    message: "A criação ainda não foi confirmada como disponível. A tentativa foi preservada para revisão.",
    severity: "warning",
    retryable: false,
  },
  SAVE_OPERATION_CONFLICT: {
    title: "O projeto foi atualizado",
    message: "O projeto mudou antes da publicação. Suas alterações foram preservadas para revisão. Exporte o rascunho antes de recarregar.",
    severity: "warning",
    retryable: false,
  },
  SAVE_OPERATION_FAILED_FINAL: {
    title: "A tentativa precisa de revisão",
    message: "A tentativa não pôde ser concluída. A cópia foi preservada para exportação e revisão.",
    severity: "warning",
    retryable: false,
  },
  LOCAL_SAVE_PAYLOAD_EXPIRED: {
    title: "A cópia local expirou",
    message: "A cópia local desta tentativa expirou após 7 dias ou foi removida. O servidor ainda não recebeu todo o mapa. Preserve o rascunho atual antes de recarregar.",
    severity: "warning",
    retryable: false,
  },
  LOCAL_SAVE_PAYLOAD_INTEGRITY_FAILED: {
    title: "A cópia local precisa de revisão",
    message: "A cópia local não passou na verificação de integridade. Exporte o rascunho atual; esta tentativa não será reenviada.",
    severity: "warning",
    retryable: false,
  },
  SAVE_OPERATION_STATE_UNRECOGNIZED: {
    title: "Salvamento ainda não confirmado",
    message: "O estado desta tentativa ainda não pôde ser confirmado. Preserve o rascunho e verifique a mesma tentativa novamente.",
    severity: "warning",
    retryable: false,
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
  DOCUMENT_FILE_NAME_REQUIRED: {
    title: "Informe o nome do arquivo",
    message: "Digite um nome para o arquivo antes de salvar.",
    severity: "warning",
  },
  DOCUMENT_FILE_NAME_INVALID: {
    title: "Nome de arquivo inválido",
    message: "Use um nome sem barras, caracteres de controle ou símbolos reservados.",
    severity: "warning",
  },
  DOCUMENT_FILE_NAME_TOO_LONG: {
    title: "Nome de arquivo muito longo",
    message: "Use até 160 caracteres, incluindo a extensão do arquivo.",
    severity: "warning",
  },
  DOCUMENT_FILE_EXTENSION_IMMUTABLE: {
    title: "Mantenha a extensão do arquivo",
    message: "Altere apenas o nome e mantenha a extensão original, como .pdf ou .xlsx.",
    severity: "warning",
  },
  DOCUMENT_FILE_PATCH_AMBIGUOUS: {
    title: "Não foi possível atualizar o arquivo",
    message: "Renomeie ou mova o arquivo em operações separadas.",
    severity: "warning",
  },
  DOCUMENT_FILE_PATCH_INVALID: {
    title: "Não foi possível atualizar o arquivo",
    message: "Confira o nome ou a pasta de destino antes de tentar novamente.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_NAME_REQUIRED: {
    title: "Não foi possível atualizar a pasta",
    message: "Digite um nome para a pasta antes de salvar.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_NAME_INVALID: {
    title: "Não foi possível atualizar a pasta",
    message: "Use um nome sem barras ou caracteres de controle.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_NAME_TOO_LONG: {
    title: "Não foi possível atualizar a pasta",
    message: "Use até 120 caracteres no nome da pasta.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_NAME_CONFLICT: {
    title: "Não foi possível atualizar a pasta",
    message: "Já existe uma pasta com esse nome neste local. Escolha outro nome.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_INVALID: {
    title: "Não foi possível atualizar a pasta",
    message: "Escolha uma pasta de destino válida.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_PARENT_INVALID: {
    title: "Não foi possível atualizar a pasta",
    message: "Escolha uma pasta de destino válida.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_NOT_FOUND: {
    title: "Não foi possível atualizar a pasta",
    message: "Esta pasta não está mais disponível. Atualize a lista e tente novamente.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_PARENT_NOT_FOUND: {
    title: "Não foi possível atualizar a pasta",
    message: "A pasta de destino não está mais disponível. Atualize a lista e tente novamente.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_PARENT_SCOPE_MISMATCH: {
    title: "Não foi possível atualizar a pasta",
    message: "Escolha uma pasta desta organização.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_CYCLE: {
    title: "Não foi possível atualizar a pasta",
    message: "Uma pasta não pode ser movida para dentro de si mesma ou de suas subpastas.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_SELF_PARENT: {
    title: "Não foi possível atualizar a pasta",
    message: "Uma pasta não pode ser movida para dentro de si mesma.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_DEPTH_EXCEEDED: {
    title: "Não foi possível atualizar a pasta",
    message: "O destino ultrapassa o limite de 5 níveis de pastas.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_SAME_PARENT: {
    title: "Não foi possível atualizar a pasta",
    message: "O item já está nesta pasta. Escolha outro destino.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_MOVE_CONFLICT: {
    title: "Não foi possível atualizar a pasta",
    message: "A pasta ou o destino mudou. Atualize a lista e tente novamente.",
    severity: "warning",
  },
  DOCUMENT_FILE_RENAME_CONFLICT: {
    title: "O documento foi atualizado",
    message: "O nome do documento mudou. Atualize a lista e tente novamente.",
    severity: "warning",
  },
  DOCUMENT_FILE_MOVE_CONFLICT: {
    title: "Não foi possível atualizar a pasta",
    message: "O documento ou o destino mudou. Atualize a lista e tente novamente.",
    severity: "warning",
  },
  DOCUMENT_FOLDER_PATCH_INVALID: {
    title: "Não foi possível atualizar a pasta",
    message: "Confira os dados da pasta antes de tentar novamente.",
    severity: "warning",
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

  // Readiness uses the same public code for transient and terminal states.
  // Respect the server decision without interpreting provider messages/details.
  if (
    diagnostic.code === "ORGANIZATION_STORAGE_NOT_READY" ||
    diagnostic.code === "ORGANIZATION_STORAGE_NOT_CONFIGURED" ||
    diagnostic.code === "ORGANIZATION_STORAGE_PROVISION_FAILED"
  ) {
    return diagnostic.retryable
      ? STORAGE_WAIT_PRESENTATION
      : STORAGE_BLOCKED_PRESENTATION;
  }

  if (diagnostic.code && CODE_PRESENTATIONS[diagnostic.code]) {
    return CODE_PRESENTATIONS[diagnostic.code];
  }

  if (diagnostic.category === "STORAGE") {
    return diagnostic.retryable
      ? STORAGE_WAIT_PRESENTATION
      : STORAGE_BLOCKED_PRESENTATION;
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
