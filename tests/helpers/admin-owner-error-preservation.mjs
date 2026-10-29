import assert from 'node:assert/strict';

// Exact inverse of the reviewed 254/255 error translation, not a new baseline.
const imports = 'import { normalizeMaonoError } from "./maono-error.js";\nimport { errorResponse } from "./http.js";\n';
const guard = '  const managementError = normalizeMaonoError(error);\n  if (managementError.code === "MANAGEMENT_OWNER_REASSIGN_REQUIRED") {\n    return errorResponse(managementError.message, 409, managementError.code, null, { retryable: false });\n  }\n';
const presentation = '  MANAGEMENT_OWNER_REASSIGN_REQUIRED: {\n    title: "Responsável principal protegido",\n    message: "Defina outro responsável principal na Gestão de Organizações antes de remover, desativar ou rebaixar este usuário.",\n    severity: "warning", retryable: false,\n  },\n';

export function restoreAdminOwnerError(path, source) {
  const additions = path === 'functions/_lib/organizations.js' ? [guard, imports]
    : path === 'src/lib/user-error-catalog.ts' ? [presentation] : [];
  for (const addition of additions) {
    assert.equal(source.split(addition).length - 1, 1, 'exact manager conflict translation');
    source = source.replace(addition, '');
  }
  return source;
}
