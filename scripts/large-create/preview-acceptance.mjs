import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import {
  buildLargeCreateFixture,
  fixtureSha256,
  LARGE_CREATE_MAX_ACCEPTANCE_BYTES,
  LARGE_CREATE_MIN_ACCEPTANCE_BYTES,
} from "./build-large-create-fixture.mjs";
import {
  beginClientSaveAttempt,
  buildSaveRequestHeaders,
} from "../../src/pages/Kepler/save-observability.ts";
import { prepareProjectCreateTransport } from "../../src/pages/Kepler/project-create-transport.ts";

const REQUIRED_CONFIRMATION = "RUN_LARGE_CREATE_PREVIEW_ACCEPTANCE";
const EXPECTED_QA_ORG_ID = String(process.env.MAONO_ACCEPTANCE_QA_ORG_ID || "9").trim();
const EXPECTED_QA_ORG_SLUG = String(
  process.env.MAONO_ACCEPTANCE_QA_ORG_SLUG || "maono-preview-qa",
).trim();
const TARGET_MIB = Number(process.env.MAONO_LARGE_CREATE_TARGET_MIB || 94);

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Preview acceptance exige HTTPS.");
  if (!/\.pages\.dev$/i.test(url.hostname)) {
    throw new Error("Preview acceptance aceita somente origin Cloudflare Pages (*.pages.dev).");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

function cookieHeaders(cookie, extra = {}) {
  return {
    Cookie: cookie,
    Accept: "application/json",
    ...extra,
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Resposta JSON inválida em ${response.url || "request"} (${response.status}).`);
  }
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const data = await readJson(response);
  return { response, data };
}

function assertOk(response, data, label, allowedStatuses = [200]) {
  if (!allowedStatuses.includes(response.status) || data?.ok === false) {
    const code = data?.error?.code || "UNKNOWN";
    const message = data?.error?.message || `HTTP ${response.status}`;
    throw new Error(`${label} falhou: ${code} — ${message}`);
  }
}

function projectIdentity(project) {
  return {
    id: project?.id ?? null,
    slug: project?.slug ?? null,
  };
}

async function main() {
  const confirmation = requiredEnv("MAONO_LARGE_CREATE_ACCEPTANCE_CONFIRMATION");
  if (confirmation !== REQUIRED_CONFIRMATION) {
    throw new Error(`Confirmação inválida. Use exatamente ${REQUIRED_CONFIRMATION}.`);
  }

  const baseUrl = normalizeBaseUrl(requiredEnv("MAONO_PREVIEW_BASE_URL"));
  const sessionCookie = requiredEnv("MAONO_PREVIEW_CREATOR_SESSION_COOKIE");

  const health = await fetchJson(`${baseUrl}/api/health`);
  assertOk(health.response, health.data, "health");
  assert.equal(health.data?.runtime?.runtime, "preview", "origin não está em runtime preview");
  assert.equal(
    health.data?.runtime?.previewMutationsEnabled,
    true,
    "MAONO_PREVIEW_MUTATIONS_ENABLED deve estar true somente durante a janela de acceptance",
  );
  assert.equal(
    health.data?.runtime?.largeCreateStreamEnabled,
    true,
    "PROJECT_CREATE_LARGE_STREAM_V1 deve estar true no Preview",
  );
  assert.equal(health.data?.checks?.databaseReachable, true);
  assert.equal(health.data?.checks?.dropboxAppKey, true);
  assert.equal(health.data?.checks?.dropboxAppSecret, true);
  assert.equal(health.data?.checks?.dropboxRefreshToken, true);

  const session = await fetchJson(`${baseUrl}/api/session`, {
    headers: cookieHeaders(sessionCookie),
  });
  assertOk(session.response, session.data, "session");
  assert.equal(session.data?.authenticated, true, "sessão QA não autenticada");
  assert.equal(
    String(session.data?.activeOrganization?.id ?? session.data?.user?.activeOrganizationId ?? ""),
    EXPECTED_QA_ORG_ID,
    "sessão QA não está na organização esperada",
  );
  assert.equal(
    String(session.data?.activeOrganization?.slug ?? session.data?.user?.activeOrganization?.slug ?? ""),
    EXPECTED_QA_ORG_SLUG,
    "slug da organização ativa não é o QA esperado",
  );
  assert.equal(session.data?.user?.role, "editor", "creator QA deve usar perfil editor");
  const permissions = new Set([
    ...(Array.isArray(session.data?.permissions) ? session.data.permissions : []),
    ...(Array.isArray(session.data?.user?.permissions) ? session.data.user.permissions : []),
  ]);
  assert.equal(
    permissions.has("project.create"),
    true,
    "sessão QA precisa da permissão project.create",
  );

  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const name = `QA Smoke Large Create ${timestamp}`;
  const description = "Acceptance descartável do Large CREATE streaming.";
  const idempotencyKey = `large-create:${timestamp}:${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const fixture = buildLargeCreateFixture({ targetMiB: TARGET_MIB });
  assert.ok(fixture.sizeBytes >= LARGE_CREATE_MIN_ACCEPTANCE_BYTES);
  assert.ok(fixture.sizeBytes <= LARGE_CREATE_MAX_ACCEPTANCE_BYTES);
  const localSha256 = fixtureSha256(fixture.body);

  const attempt = beginClientSaveAttempt("create");
  const prepared = prepareProjectCreateTransport(attempt, {
    name,
    description,
    organizationId: Number(EXPECTED_QA_ORG_ID),
    idempotencyKey,
    config: fixture.config,
    legacy: null,
  });
  assert.equal(prepared.large, true);
  assert.equal(prepared.configPayloadBytes, fixture.sizeBytes);
  assert.ok(Buffer.byteLength(prepared.requestBody, "utf8") < 64 * 1024);

  const postHeaders = cookieHeaders(sessionCookie, {
    ...buildSaveRequestHeaders(attempt, { forceJson: true }),
  });
  const created = await fetchJson(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: postHeaders,
    body: prepared.requestBody,
  });
  assertOk(created.response, created.data, "metadata-first POST", [202]);
  assert.equal(created.data?.status, "pending");
  assert.equal(created.data?.creation?.transport, "stream");
  assert.equal(Number(created.data?.creation?.expectedRevision), 0);

  const createdProject = projectIdentity(created.data?.project);
  assert.ok(createdProject.id, "POST não retornou project.id");
  assert.match(String(createdProject.slug || ""), /^qa-smoke-[a-z0-9-]+$/);

  const beforePublish = await fetchJson(`${baseUrl}/api/projects`, {
    headers: cookieHeaders(sessionCookie),
  });
  assertOk(beforePublish.response, beforePublish.data, "GET projects antes do publish");
  assert.equal(
    (beforePublish.data?.projects || []).some((project) => project.slug === createdProject.slug),
    false,
    "projeto PREPARING_STORAGE não pode aparecer na listagem publicada",
  );

  const putHeaders = cookieHeaders(sessionCookie, {
    ...buildSaveRequestHeaders(attempt),
    "X-Maono-Creation-Key": idempotencyKey,
  });
  const streamed = await fetchJson(
    `${baseUrl}/api/projects/${encodeURIComponent(createdProject.slug)}/config`,
    {
      method: "PUT",
      headers: putHeaders,
      body: prepared.configBody,
    },
  );
  assertOk(streamed.response, streamed.data, "streaming PUT", [201]);
  assert.equal(streamed.data?.status, "active");
  assert.equal(streamed.data?.transport, "stream");
  assert.equal(streamed.data?.operation, "create");
  assert.equal(Number(streamed.data?.configRevision), 1);
  assert.equal(Number(streamed.data?.sizeBytes), fixture.sizeBytes);
  assert.equal(streamed.data?.project?.active, true);
  assert.equal(
    streamed.data?.lifecycle?.state ?? streamed.data?.project?.lifecycle?.state,
    "ACTIVE",
  );

  const afterPublish = await fetchJson(`${baseUrl}/api/projects`, {
    headers: cookieHeaders(sessionCookie),
  });
  assertOk(afterPublish.response, afterPublish.data, "GET projects depois do publish");
  const matches = (afterPublish.data?.projects || []).filter(
    (project) => project.slug === createdProject.slug,
  );
  assert.equal(matches.length, 1, "projeto publicado deve aparecer exatamente uma vez");

  const replay = await fetchJson(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: postHeaders,
    body: prepared.requestBody,
  });
  assertOk(replay.response, replay.data, "POST idempotente pós-commit", [200]);
  assert.equal(replay.data?.status, "active");
  assert.equal(replay.data?.idempotent, true);
  assert.equal(String(replay.data?.project?.id), String(createdProject.id));
  assert.equal(replay.data?.project?.slug, createdProject.slug);
  assert.equal(Number(replay.data?.configRevision), 1);

  // O frontend de produção mantém o Worker fora do data plane para MapConfigs
  // grandes: primeiro obtém um descriptor autenticado e depois baixa diretamente
  // do storage. O acceptance precisa validar exatamente esse caminho, não o proxy
  // legado /config-stream sem delivery=direct.
  const descriptor = await fetchJson(
    `${baseUrl}/api/projects/${encodeURIComponent(createdProject.slug)}/config-stream?delivery=direct`,
    {
      headers: cookieHeaders(sessionCookie, {
        "X-Maono-Expected-Config-Revision": "1",
      }),
    },
  );
  assertOk(descriptor.response, descriptor.data, "config-stream direct descriptor");
  assert.equal(descriptor.data?.transport, "direct");
  assert.equal(descriptor.response.headers.get("X-Maono-Config-Transport"), "direct");
  assert.equal(Number(descriptor.data?.revision), 1);
  assert.equal(Number(descriptor.data?.sizeBytes), fixture.sizeBytes);
  assert.equal(
    Number(descriptor.response.headers.get("X-Maono-Config-Size")),
    fixture.sizeBytes,
  );

  const downloadUrl = String(descriptor.data?.downloadUrl || "").trim();
  const directUrl = new URL(downloadUrl);
  assert.equal(directUrl.protocol, "https:", "descriptor deve fornecer download HTTPS");

  const configResponse = await fetch(directUrl, {
    method: "GET",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: {
      Accept: "application/json",
    },
  });
  if (!configResponse.ok) {
    const text = await configResponse.text();
    throw new Error(`download direto falhou: HTTP ${configResponse.status} ${text.slice(0, 300)}`);
  }

  const directContentLength = Number(configResponse.headers.get("content-length") || 0);
  if (directContentLength > 0) {
    assert.equal(directContentLength, fixture.sizeBytes);
  }
  const downloaded = new Uint8Array(await configResponse.arrayBuffer());
  assert.equal(downloaded.byteLength, fixture.sizeBytes);
  const downloadedSha256 = createHash("sha256").update(downloaded).digest("hex");
  assert.equal(
    downloadedSha256,
    localSha256,
    "download direto deve devolver exatamente a fixture publicada",
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    runtime: "preview",
    organizationId: EXPECTED_QA_ORG_ID,
    organizationSlug: EXPECTED_QA_ORG_SLUG,
    projectId: createdProject.id,
    slug: createdProject.slug,
    sizeBytes: fixture.sizeBytes,
    targetMiB: fixture.targetMiB,
    revision: 1,
    transport: "stream",
    readTransport: "direct",
    sha256: localSha256,
    idempotentReplay: true,
    cleanupRequired: true,
  })}\n`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
