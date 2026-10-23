import { parseJsonResponse } from "../../../lib/api-transport.ts";
import { normalizeUserError } from "../../../lib/user-error-catalog.ts";

export type UserMutationResult = {
  ok: true;
  user: { id: number };
  passwordChanged?: boolean;
  sessionsInvalidated?: boolean;
};

export class UserMutationError extends Error {
  readonly publicMessage: string;
  constructor(publicMessage: string) {
    super(publicMessage);
    // Only locally authored or catalog-normalized copy enters this field.
    // Keep presentation separate from mutable diagnostic Error.message.
    this.publicMessage = publicMessage;
  }
}

export function userMutationErrorMessage(error: unknown): string {
  return error instanceof UserMutationError ? error.publicMessage : normalizeUserError(error).message;
}

// Never retry a password write automatically: a lost response can follow a commit.
export async function submitUserMutation(url: string, init: RequestInit, timeoutMs = 30_000): Promise<UserMutationResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await readUserMutationResult(response);
  } catch (error) {
    if (error instanceof UserMutationError && !controller.signal.aborted) throw error;
    throw new UserMutationError("Não foi possível confirmar se a alteração foi concluída. Verifique o resultado antes de reenviar; não repita a troca de senha automaticamente.");
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}

async function readUserMutationResult(response: Response): Promise<UserMutationResult> {
  if (response.status === 429) {
    throw new UserMutationError("Limite de solicitações atingido. Aguarde o prazo indicado pelo serviço antes de tentar novamente.");
  }
  if (response.status >= 500 || response.status === 408) {
    throw new UserMutationError("Não foi possível confirmar se a alteração foi concluída. Verifique o resultado antes de reenviar; não repita a troca de senha automaticamente.");
  }
  let result: UserMutationResult;
  try {
    result = await parseJsonResponse<UserMutationResult>(response);
  } catch (error) {
    if (!response.ok) throw new UserMutationError(normalizeUserError(error).message);
    throw new UserMutationError("O serviço retornou uma confirmação inválida. Verifique o resultado antes de reenviar.");
  }
  if (result?.ok !== true || !result.user?.id) {
    throw new UserMutationError("O serviço retornou uma confirmação inválida. Verifique o resultado antes de reenviar.");
  }
  return result;
}
