import {
  arePreviewMutationsEnabled,
  isPreviewRuntime,
  previewQaOrganizationId,
} from "./runtime-environment.js";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const SAFE_RUNTIME_MUTATION_PATHS = [
  /^\/api\/auth(?:\/|$)/,
  /^\/api\/session(?:\/|$)/,
];

const ALWAYS_DENIED_PREVIEW_MUTATION_PATHS = [
  /^\/api\/admin(?:\/|$)/,
  /^\/api\/organizations(?:\/|$)/,
  /^\/api\/dropbox(?:\/|$)/,
];

const QA_SCOPED_MUTATION_PATHS = [
  /^\/api\/projects(?:\/|$)/,
  /^\/api\/maps\/isochrones$/,
  /^\/api\/maps\/new(?:\/|$)/,
];

const QA_SCOPED_MUTATING_PERMISSIONS = new Set([
  "project.create",
  "project.edit",
  "project.map.edit",
  "project.save",
  "project.favorite",
  "project.thumbnail.update",
]);

const ALWAYS_DENIED_PREVIEW_MUTATING_PERMISSIONS = new Set([
  "document.upload",
  "document.edit",
  "document.delete",
  "document.manage",
  "ticket.create",
  "ticket.comment",
  "ticket.manage",
  "ticket.close",
  "ticket.assign",
  "export.create",
  "export.manage",
  "roadmap.comment.create",
  "roadmap.comment.edit_own",
  "roadmap.comment.moderate",
  "roadmap.manage",
  "roadmap.task.manage",
  "roadmap.dependency.manage",
  "users.create",
  "users.edit",
  "users.disable",
  "users.delete",
  "users.invite",
  "users.manage_access",
  "permission.grant",
  "permission.revoke",
  "role.assign",
  "organization.edit",
  "plan.change_request",
  "limits.increase_request",
]);

export const PREVIEW_WRITE_REASONS = Object.freeze({
  NOT_PREVIEW: "NOT_PREVIEW",
  READ_ONLY_REQUEST: "READ_ONLY_REQUEST",
  PREVIEW_RUNTIME_MUTATION_ALLOWED: "PREVIEW_RUNTIME_MUTATION_ALLOWED",
  PREVIEW_MUTATIONS_DISABLED: "PREVIEW_MUTATIONS_DISABLED",
  PREVIEW_GLOBAL_MUTATION_DENIED: "PREVIEW_GLOBAL_MUTATION_DENIED",
  PREVIEW_MUTATION_SCOPE_UNRESOLVED: "PREVIEW_MUTATION_SCOPE_UNRESOLVED",
  PREVIEW_WRITE_OUTSIDE_QA_ORG: "PREVIEW_WRITE_OUTSIDE_QA_ORG",
  PREVIEW_QA_WRITE_ALLOWED: "PREVIEW_QA_WRITE_ALLOWED",
});

function pathMatches(pathname, patterns) {
  return patterns.some((pattern) => pattern.test(pathname));
}

function normalizeOrganizationId(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value).trim() || null;
}

function evaluateQaOrganizationBoundary(env, organizationId) {
  const qaOrganizationId = previewQaOrganizationId(env);
  const targetOrganizationId = normalizeOrganizationId(organizationId);

  if (!qaOrganizationId || !targetOrganizationId) {
    return {
      allowed: false,
      reason: PREVIEW_WRITE_REASONS.PREVIEW_MUTATION_SCOPE_UNRESOLVED,
    };
  }

  if (String(qaOrganizationId) !== String(targetOrganizationId)) {
    return {
      allowed: false,
      reason: PREVIEW_WRITE_REASONS.PREVIEW_WRITE_OUTSIDE_QA_ORG,
    };
  }

  return {
    allowed: true,
    reason: PREVIEW_WRITE_REASONS.PREVIEW_QA_WRITE_ALLOWED,
  };
}

export function isMutatingMethod(method) {
  return MUTATING_METHODS.has(String(method || "").toUpperCase());
}

export function isPreviewRuntimeMutationPath(pathname) {
  return pathMatches(String(pathname || ""), SAFE_RUNTIME_MUTATION_PATHS);
}

export function isPreviewAlwaysDeniedMutationPath(pathname) {
  return pathMatches(
    String(pathname || ""),
    ALWAYS_DENIED_PREVIEW_MUTATION_PATHS,
  );
}

export function isPreviewQaScopedMutationPath(pathname) {
  return pathMatches(String(pathname || ""), QA_SCOPED_MUTATION_PATHS);
}

export function evaluatePreviewWritePolicy(
  env,
  { method, pathname, organizationId = null } = {},
) {
  if (!isPreviewRuntime(env)) {
    return { allowed: true, reason: PREVIEW_WRITE_REASONS.NOT_PREVIEW };
  }

  if (!isMutatingMethod(method)) {
    return { allowed: true, reason: PREVIEW_WRITE_REASONS.READ_ONLY_REQUEST };
  }

  const normalizedPath = String(pathname || "");

  if (isPreviewRuntimeMutationPath(normalizedPath)) {
    return {
      allowed: true,
      reason: PREVIEW_WRITE_REASONS.PREVIEW_RUNTIME_MUTATION_ALLOWED,
    };
  }

  if (!arePreviewMutationsEnabled(env)) {
    return {
      allowed: false,
      reason: PREVIEW_WRITE_REASONS.PREVIEW_MUTATIONS_DISABLED,
    };
  }

  if (isPreviewAlwaysDeniedMutationPath(normalizedPath)) {
    return {
      allowed: false,
      reason: PREVIEW_WRITE_REASONS.PREVIEW_GLOBAL_MUTATION_DENIED,
    };
  }

  if (!isPreviewQaScopedMutationPath(normalizedPath)) {
    return {
      allowed: false,
      reason: PREVIEW_WRITE_REASONS.PREVIEW_GLOBAL_MUTATION_DENIED,
    };
  }

  return evaluateQaOrganizationBoundary(env, organizationId);
}

export function evaluatePreviewPermissionPolicy(
  env,
  { permission, organizationId = null } = {},
) {
  if (!isPreviewRuntime(env)) {
    return { allowed: true, reason: PREVIEW_WRITE_REASONS.NOT_PREVIEW };
  }

  const normalizedPermission = String(permission || "").trim();

  if (ALWAYS_DENIED_PREVIEW_MUTATING_PERMISSIONS.has(normalizedPermission)) {
    return {
      allowed: false,
      reason: PREVIEW_WRITE_REASONS.PREVIEW_GLOBAL_MUTATION_DENIED,
    };
  }

  if (!QA_SCOPED_MUTATING_PERMISSIONS.has(normalizedPermission)) {
    return {
      allowed: true,
      reason: PREVIEW_WRITE_REASONS.READ_ONLY_REQUEST,
    };
  }

  if (!arePreviewMutationsEnabled(env)) {
    return {
      allowed: false,
      reason: PREVIEW_WRITE_REASONS.PREVIEW_MUTATIONS_DISABLED,
    };
  }

  return evaluateQaOrganizationBoundary(env, organizationId);
}

export function previewWriteDeniedResponse(reason) {
  const messages = {
    [PREVIEW_WRITE_REASONS.PREVIEW_MUTATIONS_DISABLED]:
      "As escritas de homologação estão desativadas neste Preview.",
    [PREVIEW_WRITE_REASONS.PREVIEW_GLOBAL_MUTATION_DENIED]:
      "Esta operação não pode alterar dados globais no ambiente Preview.",
    [PREVIEW_WRITE_REASONS.PREVIEW_MUTATION_SCOPE_UNRESOLVED]:
      "Não foi possível confirmar o escopo QA desta operação.",
    [PREVIEW_WRITE_REASONS.PREVIEW_WRITE_OUTSIDE_QA_ORG]:
      "O Preview só pode alterar dados da organização QA autorizada.",
  };

  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: reason,
        message:
          messages[reason] ||
          "A operação foi bloqueada pela política de segurança do Preview.",
      },
    }),
    {
      status: 403,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Maono-Runtime-Env": "preview",
        "X-Maono-Preview-Write": "denied",
      },
    },
  );
}
