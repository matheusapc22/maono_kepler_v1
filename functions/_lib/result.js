import { normalizeMaonoError } from "./maono-error.js";

export function ok(value) {
  return { ok: true, value };
}

export function err(error, options = {}) {
  return {
    ok: false,
    error: normalizeMaonoError(error, options),
  };
}

export function unwrapResult(result) {
  if (result?.ok) return result.value;
  throw normalizeMaonoError(result?.error || new Error("Resultado inválido."));
}
