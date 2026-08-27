import { requireSession } from "./_lib/auth.js";
import {
  evaluatePreviewWritePolicy,
  isMutatingMethod,
  isPreviewQaScopedMutationPath,
  isPreviewRuntimeMutationPath,
  previewWriteDeniedResponse,
} from "./_lib/preview-write-policy.js";
import { isPreviewRuntime } from "./_lib/runtime-environment.js";

function decodePathPart(value) {
  try {
    return decodeURIComponent(String(value || "")).trim();
  } catch {
    return String(value || "").trim();
  }
}

export function isLikelyCloudflarePreviewUrl(value) {
  let hostname = "";
  try {
    hostname = new URL(String(value || "")).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (!hostname.endsWith(".pages.dev")) return false;

  // Production padrão: maono-kepler-v1.pages.dev (3 labels).
  // Deployment/branch Preview: <hash|branch>.maono-kepler-v1.pages.dev (4+ labels).
  return hostname.split(".").length >= 4;
}

function previewPolicyEnv(env, requestUrl) {
  if (isPreviewRuntime(env)) return env;
  if (!isLikelyCloudflarePreviewUrl(requestUrl)) return null;

  // Fallback fail-closed: se o binding Preview for configurado antes da variável
  // MAONO_RUNTIME_ENV, URLs de deployment continuam protegidas. A cópia é usada
  // apenas pela política; DB/session continuam usando o `env` original.
  return {
    ...env,
    MAONO_RUNTIME_ENV: "preview",
  };
}

export function extractProjectSlugFromPath(pathname) {
  const match = String(pathname || "").match(/^\/api\/projects\/([^/]+)(?:\/|$)/);
  return match ? decodePathPart(match[1]) || null : null;
}

function activeOrganizationId(user) {
  return (
    user?.activeOrganizationId ??
    user?.active_organization_id ??
    user?.organizationId ??
    user?.organization_id ??
    null
  );
}

async function organizationIdForProjectSlug(env, slug) {
  if (!slug || !env?.DB?.prepare) return null;
  const row = await env.DB.prepare(
    `SELECT organization_id
       FROM projects
      WHERE slug = ?
      LIMIT 1`,
  )
    .bind(slug)
    .first();
  return row?.organization_id ?? null;
}

async function requestUser(env, request) {
  try {
    return await requireSession(env, request);
  } catch {
    return null;
  }
}

async function isochroneTargetOrganizationId(env, request) {
  let body = null;
  try {
    body = await request.clone().json();
  } catch {
    body = null;
  }

  const projectSlug = String(body?.projectSlug || "").trim();
  if (projectSlug) {
    return organizationIdForProjectSlug(env, projectSlug);
  }

  const user = await requestUser(env, request);
  return activeOrganizationId(user);
}

export async function resolvePreviewMutationOrganizationId(
  env,
  request,
  pathname,
) {
  const projectSlug = extractProjectSlugFromPath(pathname);
  if (projectSlug) {
    return organizationIdForProjectSlug(env, projectSlug);
  }

  if (String(pathname || "") === "/api/maps/isochrones") {
    return isochroneTargetOrganizationId(env, request);
  }

  if (
    String(pathname || "") === "/api/projects" ||
    String(pathname || "").startsWith("/api/maps/new")
  ) {
    const user = await requestUser(env, request);
    return activeOrganizationId(user);
  }

  return null;
}

function withPreviewHeaders(response, decision) {
  const headers = new Headers(response.headers);
  headers.set("X-Maono-Runtime-Env", "preview");
  headers.set(
    "X-Maono-Preview-Write",
    decision?.reason || "READ_ONLY_REQUEST",
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const policyEnv = previewPolicyEnv(env, request.url);

  if (!policyEnv) {
    return context.next();
  }

  const pathname = url.pathname;
  const method = request.method;

  if (!isMutatingMethod(method)) {
    const response = await context.next();
    return withPreviewHeaders(response, { reason: "READ_ONLY_REQUEST" });
  }

  if (isPreviewRuntimeMutationPath(pathname)) {
    const decision = evaluatePreviewWritePolicy(policyEnv, {
      method,
      pathname,
      organizationId: null,
    });
    const response = await context.next();
    return withPreviewHeaders(response, decision);
  }

  let organizationId = null;
  if (isPreviewQaScopedMutationPath(pathname)) {
    organizationId = await resolvePreviewMutationOrganizationId(
      env,
      request,
      pathname,
    );
  }

  const decision = evaluatePreviewWritePolicy(policyEnv, {
    method,
    pathname,
    organizationId,
  });

  if (!decision.allowed) {
    return previewWriteDeniedResponse(decision.reason);
  }

  const response = await context.next();
  return withPreviewHeaders(response, decision);
}
