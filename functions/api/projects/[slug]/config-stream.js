import {
  errorResponse,
  errorResponseFromError,
  methodNotAllowed,
} from "../../../_lib/http.js";
import {
  getOrCreateCorrelationId,
  normalizeMaonoError,
} from "../../../_lib/maono-error.js";
import { requireSession } from "../../../_lib/auth.js";
import { getAuthorizedProject } from "../../../_lib/projects.js";
import { can, recordAuditLog } from "../../../_lib/permissions.js";
import {
  downloadDropboxBinaryFile,
  getDropboxMetadata,
} from "../../../_lib/dropbox.js";
import {
  PROJECT_LIFECYCLE_STATES,
  assertActiveProjectInvariant,
  getProjectLifecycleRow,
  isLifecycleManagedProject,
} from "../../../_lib/project-lifecycle.js";
import {
  assertMapConfigStorageRef,
  getMapConfigRevisionFileName,
} from "../../../_lib/map-config-storage-ref.js";

const STREAM_START_TIMEOUT_MS = 20_000;
const STREAM_INACTIVITY_TIMEOUT_MS = 20_000;
const EXPECTED_REVISION_HEADER = "X-Maono-Expected-Config-Revision";

function decodeProjectSlug(value) {
  try {
    return decodeURIComponent(String(value || "")).trim();
  } catch {
    return String(value || "").trim();
  }
}

function organizationId(project) {
  return project?.organization_id ?? project?.organizationId ?? null;
}

async function hydrateLifecycleProject(env, project) {
  const orgId = organizationId(project);
  if (!project?.id || !orgId) return project;

  try {
    const lifecycleRow = await getProjectLifecycleRow(env, {
      projectId: project.id,
      organizationId: orgId,
    });
    return lifecycleRow ? { ...project, ...lifecycleRow } : project;
  } catch (error) {
    if (/no such column|no such table/i.test(String(error?.message || ""))) {
      return project;
    }
    throw error;
  }
}

function streamError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function readExpectedRevision(request) {
  const raw = String(request.headers.get(EXPECTED_REVISION_HEADER) || "").trim();
  if (!raw) return null;

  const revision = Number(raw);
  if (!Number.isInteger(revision) || revision < 0) {
    throw streamError(
      "A revisão esperada informada pelo cliente é inválida.",
      400,
      "PROJECT_CONFIG_EXPECTED_REVISION_INVALID",
    );
  }

  return revision;
}

function resolvePublishedFile(project) {
  const defaultFile = project?.default_config_file || "config.kepler.json";

  if (!isLifecycleManagedProject(project)) {
    return {
      fileName: defaultFile,
      revision: Number(project?.config_revision || 0),
      sizeBytes: Number(project?.config_size_bytes || 0),
      providerHash: project?.config_storage_provider_hash || null,
      schemaName: project?.config_schema || "legacy-kepler",
      schemaVersion: Number(project?.config_schema_version || 1),
      legacy: true,
    };
  }

  if (project.lifecycle_state !== PROJECT_LIFECYCLE_STATES.ACTIVE) {
    throw streamError(
      "O projeto ainda não está publicável.",
      409,
      "PROJECT_LIFECYCLE_NOT_ACTIVE",
      { lifecycleState: project.lifecycle_state },
    );
  }

  assertActiveProjectInvariant(project);

  const revision = Number(project.config_revision);
  assertMapConfigStorageRef(project.config_storage_ref, project.id, revision);

  return {
    fileName: getMapConfigRevisionFileName(defaultFile, revision),
    revision,
    sizeBytes: Number(project.config_size_bytes || 0),
    providerHash: project.config_storage_provider_hash || null,
    schemaName: project.config_schema || "legacy-kepler",
    schemaVersion: Number(project.config_schema_version || 1),
    legacy: false,
  };
}

function assertExpectedRevision(expectedRevision, publishedRevision) {
  if (expectedRevision === null || expectedRevision === publishedRevision) return;

  throw streamError(
    "A revisão publicada mudou durante a repetição do carregamento.",
    409,
    "PROJECT_CONFIG_STREAM_REVISION_CHANGED",
    {
      expectedRevision,
      actualRevision: publishedRevision,
    },
  );
}

function assertPublishedMetadata(published, metadata) {
  const metadataSize = Number(metadata?.size || 0);
  const metadataHash = String(
    metadata?.content_hash ?? metadata?.contentHash ?? "",
  ).trim().toLowerCase();
  const expectedHash = String(published.providerHash || "")
    .trim()
    .toLowerCase();

  if (
    published.sizeBytes > 0 &&
    metadataSize > 0 &&
    published.sizeBytes !== metadataSize
  ) {
    throw streamError(
      "O tamanho da configuração publicada não corresponde ao storage.",
      409,
      "PROJECT_CONFIG_SIZE_MISMATCH",
      {
        expectedSizeBytes: published.sizeBytes,
        actualSizeBytes: metadataSize,
      },
    );
  }

  if (expectedHash && metadataHash && expectedHash !== metadataHash) {
    throw streamError(
      "O storage não confirmou a revisão publicada do projeto.",
      409,
      "PROJECT_CONFIG_STORAGE_INTEGRITY_MISMATCH",
      {
        verificationMethod: "provider-content-hash",
      },
    );
  }

  return {
    sizeBytes: metadataSize || published.sizeBytes || 0,
    metadataSizeBytes: metadataSize,
    providerHashVerified: Boolean(expectedHash && metadataHash),
  };
}

async function auditStream(env, request, user, project, slug, result, metadata = {}) {
  await recordAuditLog(env, {
    actorUserId: user?.id,
    organizationId: organizationId(project),
    projectId: project?.id ?? null,
    action: "projects.config.stream",
    resourceType: "project",
    resourceId: project?.slug ?? slug ?? project?.id ?? null,
    result,
    metadata,
    request,
  });
}

function scheduleAudit(context, task, label = "stream") {
  const settled = Promise.resolve(task).catch((error) => {
    console.warn("[Maono config-stream] Audit assíncrono falhou", {
      label,
      code: error?.code || "AUDIT_WRITE_FAILED",
    });
  });

  if (typeof context?.waitUntil === "function") {
    context.waitUntil(settled);
  }
}

async function withStreamStartDeadline(task, timeoutMs = STREAM_START_TIMEOUT_MS) {
  let timeoutId = null;

  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            streamError(
              "O storage não iniciou o stream do projeto dentro do prazo.",
              504,
              "PROJECT_CONFIG_STREAM_START_TIMEOUT",
              { timeoutMs },
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function withStreamInactivityWatchdog(
  source,
  timeoutMs = STREAM_INACTIVITY_TIMEOUT_MS,
) {
  if (!source || typeof source.getReader !== "function") {
    throw streamError(
      "O storage não disponibilizou um stream legível para o projeto.",
      502,
      "PROJECT_CONFIG_STREAM_BODY_UNAVAILABLE",
    );
  }

  const reader = source.getReader();
  let timeoutId = null;
  let closed = false;
  let readInFlight = null;
  let downstreamController = null;

  const clearWatchdog = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const failForInactivity = () => {
    if (closed) return;
    closed = true;
    clearWatchdog();
    const error = streamError(
      "O stream do projeto ficou sem progresso e foi interrompido.",
      504,
      "PROJECT_CONFIG_STREAM_INACTIVITY_TIMEOUT",
      { timeoutMs },
    );
    Promise.resolve(reader.cancel(error)).catch(() => undefined);
    downstreamController?.error(error);
  };

  const armWatchdog = () => {
    clearWatchdog();
    timeoutId = setTimeout(failForInactivity, timeoutMs);
  };

  return new ReadableStream(
    {
      pull(controller) {
        if (closed) return undefined;
        downstreamController = controller;
        if (readInFlight) return readInFlight;

        armWatchdog();
        readInFlight = (async () => {
          try {
            const { done, value } = await reader.read();
            clearWatchdog();

            if (closed) return;
            if (done) {
              closed = true;
              controller.close();
              return;
            }

            controller.enqueue(value);
          } catch (error) {
            clearWatchdog();
            if (closed) return;
            closed = true;
            controller.error(error);
          } finally {
            readInFlight = null;
          }
        })();

        return readInFlight;
      },
      cancel(reason) {
        closed = true;
        clearWatchdog();
        downstreamController = null;
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

async function preparePublishedUpstream(env, project, published) {
  return withStreamStartDeadline(async () => {
    // Save S05/S03 already verifies the immutable object before publication.
    // On every read we re-check cheap provider metadata (size/content hash when
    // available) instead of downloading the whole object into Worker memory to
    // recompute SHA-256. The actual bytes are then proxied as a stream.
    const storageMetadata = await getDropboxMetadata(
      env,
      project.dropbox_root_path,
      published.fileName,
    );
    const verifiedMetadata = assertPublishedMetadata(
      published,
      storageMetadata,
    );

    const upstream = await downloadDropboxBinaryFile(
      env,
      project.dropbox_root_path,
      published.fileName,
    );

    const upstreamSize = Number(upstream.headers.get("content-length") || 0);
    if (
      verifiedMetadata.sizeBytes > 0 &&
      upstreamSize > 0 &&
      verifiedMetadata.sizeBytes !== upstreamSize
    ) {
      throw streamError(
        "O tamanho recebido do storage mudou durante o carregamento.",
        409,
        "PROJECT_CONFIG_SIZE_MISMATCH",
        {
          expectedSizeBytes: verifiedMetadata.sizeBytes,
          actualSizeBytes: upstreamSize,
        },
      );
    }

    const contentLengthBytes =
      verifiedMetadata.metadataSizeBytes > 0 &&
      upstreamSize > 0 &&
      verifiedMetadata.metadataSizeBytes === upstreamSize
        ? upstreamSize
        : null;

    return {
      upstream,
      verifiedMetadata,
      sizeBytes: upstreamSize || verifiedMetadata.sizeBytes || 0,
      contentLengthBytes,
    };
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const correlationId = getOrCreateCorrelationId(request);

  if (request.method !== "GET") {
    return methodNotAllowed(["GET"], { correlationId });
  }

  let user = null;
  let project = null;
  let slug = null;

  try {
    user = await requireSession(env, request);
    slug = decodeProjectSlug(params?.slug);

    if (!slug) {
      return errorResponse(
        "Slug do projeto não informado.",
        400,
        "PROJECT_SLUG_REQUIRED",
        null,
        { correlationId },
      );
    }

    project = await getAuthorizedProject(env, user, slug);
    if (!project) {
      return errorResponse(
        "Projeto não encontrado ou sem permissão de acesso.",
        404,
        "PROJECT_NOT_FOUND",
        null,
        { correlationId },
      );
    }

    project = await hydrateLifecycleProject(env, project);

    const decision = await can(env, user, "project.view", {
      project,
      projectId: project?.id ?? null,
      projectSlug: project?.slug ?? slug,
      organizationId: organizationId(project),
    });

    if (!decision.allowed) {
      scheduleAudit(
        context,
        auditStream(env, request, user, project, slug, "denied", {
          permission: "project.view",
          reason: decision.reason,
          correlationId,
        }),
        "denied",
      );
      throw streamError("Acesso negado.", 403, "FORBIDDEN", {
        permission: "project.view",
        reason: decision.reason || "DENY_BY_DEFAULT",
      });
    }

    const published = resolvePublishedFile(project);
    const expectedRevision = readExpectedRevision(request);
    assertExpectedRevision(expectedRevision, published.revision);

    const {
      upstream,
      verifiedMetadata,
      sizeBytes,
      contentLengthBytes,
    } = await preparePublishedUpstream(env, project, published);

    const body = withStreamInactivityWatchdog(upstream.body);

    scheduleAudit(
      context,
      auditStream(env, request, user, project, slug, "success", {
        permission: "project.view",
        correlationId,
        configRevision: published.revision,
        expectedRevision,
        lifecycleState: project.lifecycle_state ?? null,
        schemaName: published.schemaName,
        schemaVersion: published.schemaVersion,
        sizeBytes,
        transport: "stream",
        integrity:
          verifiedMetadata.providerHashVerified
            ? "provider-content-hash"
            : "size-metadata",
        legacy: published.legacy,
      }),
      "success",
    );

    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Correlation-Id": correlationId,
      "X-Maono-Config-Transport": "stream",
      "X-Maono-Project-Id": String(project.id),
      "X-Maono-Config-Revision": String(published.revision || 0),
      "X-Maono-Config-Size": String(sizeBytes || 0),
      "X-Maono-Config-Schema": String(published.schemaName || ""),
      "X-Maono-Config-Schema-Version": String(published.schemaVersion || 0),
    });
    if (contentLengthBytes !== null) {
      headers.set("Content-Length", String(contentLengthBytes));
    }

    return new Response(body, {
      status: 200,
      headers,
    });
  } catch (error) {
    const normalized = normalizeMaonoError(error, {
      defaultCode: "PROJECT_CONFIG_STREAM_ERROR",
      correlationId,
    });

    if (user && project) {
      scheduleAudit(
        context,
        auditStream(env, request, user, project, slug, "error", {
          correlationId,
          reason: normalized.code || "PROJECT_CONFIG_STREAM_ERROR",
          category: normalized.category || null,
          retryable:
            typeof normalized.retryable === "boolean"
              ? normalized.retryable
              : null,
        }),
        "error",
      );
    }

    return errorResponseFromError(normalized, {
      correlationId,
      publicMessage:
        Number(normalized.status || 500) >= 500
          ? "Não foi possível carregar a configuração do projeto."
          : undefined,
    });
  }
}
