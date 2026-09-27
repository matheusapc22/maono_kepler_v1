import {
  appendOrganizationBinaryUpload,
  buildStoredFileName,
  finishOrganizationBinaryUpload,
  getOrganizationBinaryMetadata,
  organizationFileDropboxPath,
  splitDropboxFilePath,
  startOrganizationBinaryUpload,
} from "./organization-files.js";
import { canonicalOrganizationRoot } from "./organization-storage.js";
import { requireOrganizationStorageReady } from "./organization-storage-readiness.js";
import {
  getDb,
  getOrganizationOrThrow,
  getTableColumns,
  tableExists,
} from "./organizations.js";
import {
  assertTicketAttachmentFirstChunk,
  enforceTicketAttachmentRateLimit,
  getTicketOrThrow,
  publicTicketAttachment,
  TICKET_ATTACHMENT_LIMITS,
  validateTicketAttachmentMetadata,
} from "./ticket-center.js";

const ACTIVE_STATES = new Set(["RESERVED", "UPLOADING", "FINALIZING", "RECONCILE"]);
const TERMINAL_STATES = new Set(["COMPLETED", "CANCELLED", "EXPIRED", "FAILED"]);
const REQUIRED_ATTACHMENT_COLUMNS = Object.freeze(["upload_session_id", "provider_content_hash"]);
const REQUIRED_SESSION_COLUMNS = Object.freeze([
  "id", "organization_id", "ticket_id", "user_id", "storage_key", "expected_size",
  "expected_content_hash", "target_audience", "draft_id", "provider_session_id",
  "acknowledged_offset", "version", "state", "idle_expires_at", "hard_expires_at",
]);
const REQUIRED_TRIGGERS = Object.freeze([
  "cc06_upload_capacity",
  "cc06_upload_initial_state",
  "cc06_upload_state_transition",
  "cc06_upload_version",
  "cc06_upload_offset_monotonic",
  "cc06_attachment_session_scope",
]);
const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const HARD_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function uploadError(message, status = 400, code = "TICKET_ATTACHMENT_UPLOAD_INVALID", details = undefined) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix = "tau") {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${value}`;
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function cleanHash(value) {
  const hash = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw uploadError(
      "A identidade do arquivo é inválida. Selecione o arquivo novamente.",
      400,
      "ATTACHMENT_CONTENT_HASH_INVALID",
    );
  }
  return hash;
}

function etag(row) {
  return `\"ticket-upload:${row.id}:${Number(row.version || 1)}\"`;
}

function assertEtag(request, row) {
  const supplied = String(request?.headers?.get?.("If-Match") || "").trim();
  if (!supplied || supplied !== etag(row)) {
    throw uploadError(
      "A sessão de upload mudou. Atualize o estado e tente novamente.",
      412,
      "ATTACHMENT_UPLOAD_PRECONDITION_FAILED",
      { etag: etag(row), expectedOffset: Number(row.acknowledged_offset || 0) },
    );
  }
}

function expired(row, now = Date.now()) {
  return now >= Number(row.idle_expires_at || 0) || now >= Number(row.hard_expires_at || 0);
}

function assertSessionContext(row, context, { mutation = false } = {}) {
  if (
    !row ||
    String(row.organization_id) !== String(context.organizationId) ||
    String(row.ticket_id) !== String(context.ticketId) ||
    String(row.user_id) !== String(context.userId)
  ) {
    throw uploadError("Sessão de upload não encontrada.", 404, "ATTACHMENT_UPLOAD_NOT_FOUND");
  }
  if (!context.ticketComment) {
    throw uploadError("Você não pode alterar anexos deste chamado.", 403, "ATTACHMENT_UPLOAD_FORBIDDEN");
  }
  if (row.draft_id && (
    row.draft_state !== "active" ||
    String(row.draft_user_id || "") !== String(context.userId) ||
    String(row.draft_audience || "") !== String(row.target_audience)
  )) {
    throw uploadError("Sessão de upload não encontrada.", 404, "ATTACHMENT_UPLOAD_NOT_FOUND");
  }
  if (row.target_audience === "internal" && !context.noteCreate) {
    throw uploadError("Você não pode continuar este upload interno.", 403, "ATTACHMENT_UPLOAD_FORBIDDEN");
  }
  if (mutation && context.ticketClosed) {
    throw uploadError("Não é possível continuar anexos de um chamado concluído.", 409, "TICKET_CLOSED");
  }
  if (expired(row)) {
    throw uploadError(
      "Esta sessão de upload expirou. Inicie um novo envio.",
      410,
      "ATTACHMENT_UPLOAD_EXPIRED",
    );
  }
  if (TERMINAL_STATES.has(String(row.state))) {
    throw uploadError("Esta sessão de upload já foi encerrada.", 409, "ATTACHMENT_UPLOAD_TERMINAL");
  }
  return row;
}

function publicSession(row, attachment = null) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    ticketId: row.ticket_id,
    attachmentId: attachment?.id ?? row.attachment_id ?? null,
    name: attachment?.original_name ?? row.original_name ?? "Arquivo",
    mimeType: attachment?.mime_type ?? row.mime_type ?? null,
    size: Number(row.expected_size || 0),
    expectedContentHash: row.expected_content_hash,
    targetAudience: row.target_audience,
    draftId: row.draft_id || null,
    offset: Number(row.acknowledged_offset || 0),
    version: Number(row.version || 1),
    state: row.state,
    expiresAt: new Date(Math.min(Number(row.idle_expires_at), Number(row.hard_expires_at))).toISOString(),
    hardExpiresAt: new Date(Number(row.hard_expires_at)).toISOString(),
    etag: etag(row),
  };
}

export function isTicketResumableUploadsEnabled(env) {
  return String(env?.MAONO_TICKET_RESUMABLE_UPLOADS_ENABLED || "").trim().toLowerCase() === "true";
}

async function columnsInclude(env, table, expected) {
  try {
    const columns = await getTableColumns(env, table);
    return expected.every((column) => columns.has(column));
  } catch {
    return false;
  }
}

export async function getTicketResumableUploadCapability(env) {
  const configured = isTicketResumableUploadsEnabled(env);
  if (!configured) return { configured: false, schemaReady: false, enabled: false };
  const tableReady = await tableExists(env, "ticket_attachment_upload_sessions").catch(() => false);
  const [sessionColumns, attachmentColumns] = await Promise.all([
    tableReady ? columnsInclude(env, "ticket_attachment_upload_sessions", REQUIRED_SESSION_COLUMNS) : false,
    columnsInclude(env, "ticket_attachments", REQUIRED_ATTACHMENT_COLUMNS),
  ]);
  let triggersReady = false;
  if (tableReady) {
    try {
      const result = await getDb(env)
        .prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name IN (${REQUIRED_TRIGGERS.map(() => "?").join(",")})`)
        .bind(...REQUIRED_TRIGGERS)
        .all();
      const names = new Set((result?.results || []).map((row) => String(row.name)));
      triggersReady = REQUIRED_TRIGGERS.every((name) => names.has(name));
    } catch {
      triggersReady = false;
    }
  }
  const schemaReady = Boolean(tableReady && sessionColumns && attachmentColumns && triggersReady);
  return { configured, schemaReady, enabled: configured && schemaReady };
}

export async function assertTicketResumableUploadReady(env) {
  const capability = await getTicketResumableUploadCapability(env);
  if (!capability.configured) {
    throw uploadError("Uploads retomáveis ainda não estão habilitados neste ambiente.", 503, "TICKET_RESUMABLE_UPLOADS_DISABLED");
  }
  if (!capability.schemaReady) {
    throw uploadError("Uploads retomáveis estão indisponíveis porque a migration 0029 ainda não foi confirmada neste ambiente.", 503, "TICKET_RESUMABLE_UPLOADS_SCHEMA_OUTDATED");
  }
  return capability;
}

async function cleanupExpiredReservations(env, organizationId, ticketId) {
  const now = Date.now();
  const timestamp = nowIso();
  const db = getDb(env);
  await db.batch([
    db.prepare(`UPDATE ticket_attachment_upload_sessions
      SET state='EXPIRED', version=version+1, last_error_code='ATTACHMENT_UPLOAD_EXPIRED', last_error_at=?, updated_at=?
      WHERE organization_id=? AND ticket_id=?
        AND state IN ('RESERVED','UPLOADING','FINALIZING','RECONCILE')
        AND (idle_expires_at <= ? OR hard_expires_at <= ?)`)
      .bind(timestamp, timestamp, organizationId, ticketId, now, now),
    db.prepare(`UPDATE ticket_attachments
      SET status='FAILED', error_message='Sessão de upload expirada.', deleted_at=COALESCE(deleted_at, ?), updated_at=?
      WHERE organization_id=? AND ticket_id=? AND status='PENDING' AND upload_session_id IN (
        SELECT id FROM ticket_attachment_upload_sessions
        WHERE organization_id=? AND ticket_id=? AND state='EXPIRED'
      )`)
      .bind(timestamp, timestamp, organizationId, ticketId, organizationId, ticketId),
  ]);
}

async function loadSession(env, organizationId, ticketId, uploadId) {
  return getDb(env).prepare(`SELECT s.*, a.id AS attachment_id, a.original_name, a.mime_type, a.status AS attachment_status,
      a.audience AS attachment_audience, a.uploaded_by AS attachment_uploaded_by,
      d.state AS draft_state, d.user_id AS draft_user_id, d.audience AS draft_audience
    FROM ticket_attachment_upload_sessions s
    LEFT JOIN ticket_attachments a ON a.upload_session_id = s.id
    LEFT JOIN ticket_drafts d ON d.id = s.draft_id AND d.organization_id = s.organization_id AND d.ticket_id = s.ticket_id
    WHERE s.id=? AND s.organization_id=? AND s.ticket_id=? LIMIT 1`)
    .bind(String(uploadId), organizationId, ticketId)
    .first();
}

async function loadSessionByAttachment(env, organizationId, ticketId, attachmentId) {
  return getDb(env).prepare(`SELECT s.*, a.id AS attachment_id, a.original_name, a.mime_type, a.status AS attachment_status,
      a.audience AS attachment_audience, a.uploaded_by AS attachment_uploaded_by,
      d.state AS draft_state, d.user_id AS draft_user_id, d.audience AS draft_audience
    FROM ticket_attachments a
    INNER JOIN ticket_attachment_upload_sessions s ON s.id = a.upload_session_id
    LEFT JOIN ticket_drafts d ON d.id = s.draft_id AND d.organization_id = s.organization_id AND d.ticket_id = s.ticket_id
    WHERE a.id=? AND a.organization_id=? AND a.ticket_id=? LIMIT 1`)
    .bind(attachmentId, organizationId, ticketId)
    .first();
}

function targetAudience({ draft = null } = {}) {
  return draft?.audience === "internal" ? "internal" : "ticket";
}

function safeAuditDetails({ organizationId, attachmentId, ticketId, draftId = null, action }) {
  return JSON.stringify({
    organizationId,
    resourceType: "ticket_attachment",
    resourceId: attachmentId,
    result: "success",
    metadata: draftId ? { ticketId, draftId } : { ticketId },
    userAgent: null,
    action,
  });
}

export async function initiateResumableTicketAttachmentUpload(
  env,
  organizationId,
  ticketId,
  user,
  payload,
  { draft = null } = {},
) {
  await assertTicketResumableUploadReady(env);
  const ticket = await getTicketOrThrow(env, organizationId, ticketId);
  if (ticket.status === "closed") throw uploadError("Não é possível anexar arquivos a um chamado concluído.", 409, "TICKET_CLOSED");
  await enforceTicketAttachmentRateLimit(env, organizationId, user.id);
  await cleanupExpiredReservations(env, organizationId, ticketId);

  const upload = validateTicketAttachmentMetadata(payload);
  const expectedContentHash = cleanHash(payload?.contentHash ?? payload?.content_hash);
  const organization = await getOrganizationOrThrow(env, organizationId);
  requireOrganizationStorageReady(organization, { operation: "ticket.attachment.upload.start.readiness" });

  const rootPath = `${canonicalOrganizationRoot(organization)}/tickets/${ticketId}/attachments`;
  const storedName = buildStoredFileName(upload.originalName);
  const storageKey = organizationFileDropboxPath(rootPath, storedName);
  const uploadId = randomId("tau");
  const timestamp = nowIso();
  const now = Date.now();
  const idleExpiresAt = now + IDLE_TIMEOUT_MS;
  const hardExpiresAt = now + HARD_TIMEOUT_MS;
  const audience = targetAudience({ draft });
  const draftId = draft?.id ? String(draft.id) : null;
  const db = getDb(env);

  try {
    await db.batch([
      db.prepare(`INSERT INTO ticket_attachment_upload_sessions
        (id,organization_id,ticket_id,user_id,storage_key,expected_size,expected_content_hash,target_audience,draft_id,
         acknowledged_offset,version,state,idle_expires_at,hard_expires_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,0,1,'RESERVED',?,?,?,?)`)
        .bind(uploadId, organizationId, ticketId, user.id, storageKey, upload.size, expectedContentHash,
          audience, draftId, idleExpiresAt, hardExpiresAt, timestamp, timestamp),
      db.prepare(`INSERT INTO ticket_attachments
        (organization_id,ticket_id,original_name,stored_name,storage_key,mime_type,size_bytes,sha256,status,uploaded_by,
         dropbox_file_id,dropbox_rev,error_message,deleted_at,created_at,updated_at,audience,message_id,draft_id,upload_session_id,provider_content_hash)
        VALUES(?,?,?,?,?,?,?,NULL,'PENDING',?,NULL,NULL,NULL,NULL,?,?,?,NULL,?,?,NULL)`)
        .bind(organizationId, ticketId, upload.originalName, storedName, storageKey, upload.mimeType, upload.size,
          user.id, timestamp, timestamp, draftId ? "draft" : "ticket", draftId, uploadId),
    ]);
  } catch (error) {
    if (String(error?.message || "").includes("TICKET_ATTACHMENT_CAPACITY_EXCEEDED")) {
      throw uploadError("O chamado atingiu o limite de anexos ou de 150 MB reservados.", 409, "ATTACHMENT_CAPACITY_LIMIT");
    }
    throw error;
  }

  const attachment = await db.prepare(`SELECT * FROM ticket_attachments WHERE upload_session_id=? LIMIT 1`).bind(uploadId).first();
  try {
    const provider = await startOrganizationBinaryUpload(env, rootPath);
    if (!provider?.session_id) throw uploadError("O provedor não iniciou a sessão de upload.", 502, "ATTACHMENT_UPLOAD_SESSION_INVALID");
    const updatedAt = nowIso();
    const result = await db.prepare(`UPDATE ticket_attachment_upload_sessions
      SET provider_session_id=?, state='UPLOADING', version=version+1, updated_at=?
      WHERE id=? AND state='RESERVED' AND version=1`)
      .bind(provider.session_id, updatedAt, uploadId).run();
    if (changes(result) !== 1) throw uploadError("A sessão de upload mudou antes de iniciar.", 409, "ATTACHMENT_UPLOAD_CONFLICT");
    const row = await loadSession(env, organizationId, ticketId, uploadId);
    return {
      attachment: publicTicketAttachment(attachment),
      upload: {
        sessionId: row.id,
        attachmentId: attachment.id,
        offset: Number(row.acknowledged_offset || 0),
        chunkSize: TICKET_ATTACHMENT_LIMITS.chunkBytes,
        size: Number(row.expected_size),
        etag: etag(row),
        expiresAt: publicSession(row, attachment).expiresAt,
        resumable: true,
      },
    };
  } catch (error) {
    const failedAt = nowIso();
    try {
      await db.batch([
        db.prepare(`UPDATE ticket_attachment_upload_sessions
          SET state='FAILED', version=version+1, last_error_code=?, last_error_at=?, updated_at=?
          WHERE id=? AND state='RESERVED'`)
          .bind(String(error?.code || "ATTACHMENT_UPLOAD_START_FAILED").slice(0, 120), failedAt, failedAt, uploadId),
        db.prepare(`UPDATE ticket_attachments SET status='FAILED', error_message=?, deleted_at=?, updated_at=?
          WHERE upload_session_id=? AND status='PENDING'`)
          .bind(String(error?.message || "Falha ao iniciar upload").slice(0, 1000), failedAt, failedAt, uploadId),
      ]);
    } catch (cleanupError) {
      console.error("[Maono CC-06][start cleanup]", cleanupError);
    }
    throw error;
  }
}

export async function listTicketAttachmentUploadSessions(env, context) {
  await assertTicketResumableUploadReady(env);
  const now = Date.now();
  const result = await getDb(env).prepare(`SELECT s.*, a.id AS attachment_id, a.original_name, a.mime_type,
      d.state AS draft_state, d.user_id AS draft_user_id, d.audience AS draft_audience
    FROM ticket_attachment_upload_sessions s
    INNER JOIN ticket_attachments a ON a.upload_session_id = s.id
    LEFT JOIN ticket_drafts d ON d.id = s.draft_id AND d.organization_id = s.organization_id AND d.ticket_id = s.ticket_id
    WHERE s.organization_id=? AND s.ticket_id=? AND s.user_id=?
      AND s.state IN ('RESERVED','UPLOADING','FINALIZING','RECONCILE')
      AND s.idle_expires_at > ? AND s.hard_expires_at > ? AND a.status='PENDING' AND a.deleted_at IS NULL
    ORDER BY s.updated_at DESC, s.id DESC LIMIT 20`)
    .bind(context.organizationId, context.ticketId, context.userId, now, now).all();
  const output = [];
  for (const row of result?.results || []) {
    if (row.draft_id && (row.draft_state !== "active" || String(row.draft_user_id || "") !== String(context.userId))) continue;
    if (row.draft_id && String(row.draft_audience || "") !== String(row.target_audience)) continue;
    if (row.target_audience === "internal" && !context.noteCreate) continue;
    output.push(publicSession(row, row));
  }
  return output;
}

export async function getTicketAttachmentUploadSession(env, context, uploadId) {
  await assertTicketResumableUploadReady(env);
  const row = assertSessionContext(
    await loadSession(env, context.organizationId, context.ticketId, uploadId),
    context,
  );
  return publicSession(row, row);
}

function providerCorrectOffset(error) {
  const value = Number(error?.details?.correctOffset ?? error?.correctOffset);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function providerRetryable(error) {
  return error?.retryable === true || [
    "DROPBOX_TIMEOUT",
    "DROPBOX_UNAVAILABLE",
    "DROPBOX_UPLOAD_SESSION_FAILED",
  ].includes(String(error?.code || ""));
}

async function appendWithReconciliation(env, sessionId, offset, bytes) {
  const expectedEnd = offset + bytes.byteLength;
  try {
    await appendOrganizationBinaryUpload(env, sessionId, offset, bytes);
    return expectedEnd;
  } catch (firstError) {
    const firstCorrect = providerCorrectOffset(firstError);
    if (firstCorrect === expectedEnd) return expectedEnd;
    if (firstCorrect !== null && firstCorrect !== offset) throw firstError;
    if (firstCorrect === null && !providerRetryable(firstError)) throw firstError;
    try {
      await appendOrganizationBinaryUpload(env, sessionId, offset, bytes);
      return expectedEnd;
    } catch (secondError) {
      if (providerCorrectOffset(secondError) === expectedEnd) return expectedEnd;
      throw secondError;
    }
  }
}

function normalizeProviderMetadata(metadata, expectedSize = 0) {
  return {
    id: metadata?.id || null,
    rev: metadata?.rev || null,
    contentHash: String(metadata?.content_hash || "").toLowerCase() || null,
    size: Number(metadata?.size ?? expectedSize ?? 0),
  };
}

function metadataMatches(metadata, row) {
  return Boolean(
    metadata &&
    Number(metadata.size) === Number(row.expected_size) &&
    String(metadata.contentHash || "") === String(row.expected_content_hash || "")
  );
}

async function committedMetadata(env, row) {
  const { rootPath, fileName } = splitDropboxFilePath(row.storage_key);
  try {
    const metadata = normalizeProviderMetadata(await getOrganizationBinaryMetadata(env, rootPath, fileName));
    return metadataMatches(metadata, row) ? metadata : null;
  } catch (error) {
    if (error?.code === "DROPBOX_PATH_NOT_FOUND" || Number(error?.status) === 404) return null;
    throw error;
  }
}

async function finishWithReconciliation(env, row, offset, bytes) {
  const { rootPath, fileName } = splitDropboxFilePath(row.storage_key);
  const expectedEnd = offset + bytes.byteLength;
  const attempt = async (content, cursorOffset) => normalizeProviderMetadata(
    await finishOrganizationBinaryUpload(env, row.provider_session_id, cursorOffset, rootPath, fileName, content),
    row.expected_size,
  );
  try {
    const metadata = await attempt(bytes, offset);
    if (!metadataMatches(metadata, row)) throw uploadError("O arquivo final não corresponde à identidade esperada.", 409, "ATTACHMENT_UPLOAD_INTEGRITY_MISMATCH");
    return metadata;
  } catch (firstError) {
    const committed = await committedMetadata(env, row);
    if (committed) return committed;
    const correct = providerCorrectOffset(firstError);
    if (correct === expectedEnd) {
      try {
        const metadata = await attempt(new Uint8Array(0), expectedEnd);
        if (metadataMatches(metadata, row)) return metadata;
      } catch (secondError) {
        const after = await committedMetadata(env, row);
        if (after) return after;
        throw secondError;
      }
    }
    if (correct !== null && correct !== offset) throw firstError;
    if (correct === null && !providerRetryable(firstError)) throw firstError;
    try {
      const metadata = await attempt(bytes, offset);
      if (!metadataMatches(metadata, row)) throw uploadError("O arquivo final não corresponde à identidade esperada.", 409, "ATTACHMENT_UPLOAD_INTEGRITY_MISMATCH");
      return metadata;
    } catch (secondError) {
      const after = await committedMetadata(env, row);
      if (after) return after;
      throw secondError;
    }
  }
}

async function advanceOffset(env, row, nextOffset, nextState = "UPLOADING", provider = null) {
  const now = Date.now();
  const timestamp = nowIso();
  const idleExpiresAt = Math.min(now + IDLE_TIMEOUT_MS, Number(row.hard_expires_at));
  const result = await getDb(env).prepare(`UPDATE ticket_attachment_upload_sessions
    SET acknowledged_offset=?, state=?, version=version+1, idle_expires_at=?,
        provider_object_id=COALESCE(?,provider_object_id), provider_rev=COALESCE(?,provider_rev),
        provider_content_hash=COALESCE(?,provider_content_hash), last_error_code=NULL, last_error_at=NULL, updated_at=?
    WHERE id=? AND organization_id=? AND ticket_id=? AND user_id=?
      AND version=? AND acknowledged_offset=? AND state IN ('UPLOADING','RECONCILE','FINALIZING')`)
    .bind(nextOffset, nextState, idleExpiresAt, provider?.id || null, provider?.rev || null,
      provider?.contentHash || null, timestamp, row.id, row.organization_id, row.ticket_id, row.user_id,
      row.version, row.acknowledged_offset).run();
  if (changes(result) === 1) return await loadSession(env, row.organization_id, row.ticket_id, row.id);
  const current = await loadSession(env, row.organization_id, row.ticket_id, row.id);
  if (current && Number(current.acknowledged_offset) === Number(nextOffset)) return current;
  throw uploadError("A sessão mudou durante o envio. Recarregue o offset e tente novamente.", 409, "ATTACHMENT_UPLOAD_CONFLICT", {
    expectedOffset: Number(current?.acknowledged_offset || 0),
    etag: current ? etag(current) : null,
  });
}

async function publishCompleted(env, row, metadata, user, request) {
  const db = getDb(env);
  const timestamp = nowIso();
  const attachment = await db.prepare(`SELECT * FROM ticket_attachments WHERE upload_session_id=? LIMIT 1`).bind(row.id).first();
  if (!attachment) throw uploadError("Anexo reservado não encontrado.", 409, "ATTACHMENT_UPLOAD_ATTACHMENT_MISSING");
  const draftScoped = attachment.audience === "draft";
  const eventMetadata = JSON.stringify({ attachmentId: attachment.id, fileName: attachment.original_name, size: Number(row.expected_size) });
  const auditAction = draftScoped ? "ticket.draft.attachment.uploaded" : "ticket.attachment.added";
  const auditDetails = safeAuditDetails({ organizationId: row.organization_id, attachmentId: attachment.id, ticketId: row.ticket_id, draftId: attachment.draft_id, action: auditAction });
  const completedVersion = Number(row.version) + 1;
  const publicationExists = `EXISTS (
    SELECT 1 FROM ticket_attachment_upload_sessions s
    INNER JOIN ticket_attachments a ON a.upload_session_id = s.id
    WHERE s.id = ? AND s.organization_id = ? AND s.ticket_id = ?
      AND s.state = 'COMPLETED' AND s.version = ? AND s.completed_at = ?
      AND a.status = 'ACTIVE' AND a.updated_at = ? AND a.provider_content_hash = ?
  )`;
  const publicationValues = [
    row.id, row.organization_id, row.ticket_id, completedVersion, timestamp,
    timestamp, metadata.contentHash,
  ];
  const statements = [
    db.prepare(`UPDATE ticket_attachment_upload_sessions
      SET acknowledged_offset=expected_size, state='COMPLETED', version=version+1,
          provider_object_id=?, provider_rev=?, provider_content_hash=?, completed_at=?, updated_at=?
      WHERE id=? AND version=? AND state IN ('FINALIZING','RECONCILE')`)
      .bind(metadata.id, metadata.rev, metadata.contentHash, timestamp, timestamp, row.id, row.version),
    db.prepare(`UPDATE ticket_attachments
      SET status='ACTIVE', dropbox_file_id=?, dropbox_rev=?, provider_content_hash=?, error_message=NULL, updated_at=?
      WHERE upload_session_id=? AND status='PENDING'
        AND EXISTS (SELECT 1 FROM ticket_attachment_upload_sessions s
          WHERE s.id=? AND s.state='COMPLETED' AND s.version=? AND s.completed_at=?)`)
      .bind(metadata.id, metadata.rev, metadata.contentHash, timestamp, row.id,
        row.id, completedVersion, timestamp),
  ];
  if (!draftScoped) {
    statements.push(db.prepare(`INSERT INTO ticket_events
      (organization_id,ticket_id,event_type,actor_user_id,metadata,created_at,audience,message_id)
      SELECT ?,?,'ticket.attachment.added',?,?,?,'ticket',NULL
      WHERE ${publicationExists}`)
      .bind(row.organization_id, row.ticket_id, user.id, eventMetadata, timestamp, ...publicationValues));
  }
  // The final audit write is also the transactional guard. `action` is NOT NULL;
  // if this exact attempt did not complete both the session CAS and attachment
  // publication, the NULL branch aborts the whole D1 batch and rolls it back.
  statements.push(db.prepare(`INSERT INTO audit_logs(user_id,project_id,action,details,created_at)
    SELECT ?,NULL,CASE WHEN ${publicationExists} THEN ? ELSE NULL END,?,?`)
    .bind(user.id, ...publicationValues, auditAction, auditDetails, timestamp));
  const results = await db.batch(statements);
  if (changes(results?.[0]) !== 1 || changes(results?.[1]) !== 1) {
    throw uploadError("A publicação do anexo não foi confirmada.", 409, "ATTACHMENT_UPLOAD_PUBLISH_CONFLICT");
  }
  return db.prepare(`SELECT a.*, u.id AS uploader_id, u.name AS uploader_name, u.email AS uploader_email
    FROM ticket_attachments a LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.upload_session_id=? LIMIT 1`).bind(row.id).first();
}

export async function uploadTicketAttachmentSessionChunk(env, context, uploadId, user, request) {
  await assertTicketResumableUploadReady(env);
  let row = assertSessionContext(
    await loadSession(env, context.organizationId, context.ticketId, uploadId),
    context,
    { mutation: true },
  );
  assertEtag(request, row);
  const rawOffset = request.headers.get("Upload-Offset");
  const offset = Number(rawOffset);
  if (!Number.isInteger(offset) || offset < 0) throw uploadError("Offset do upload inválido.", 400, "ATTACHMENT_UPLOAD_OFFSET_INVALID");
  if (offset !== Number(row.acknowledged_offset)) {
    throw uploadError(`O envio deve continuar do byte ${row.acknowledged_offset}.`, 409, "ATTACHMENT_UPLOAD_OFFSET_MISMATCH", {
      expectedOffset: Number(row.acknowledged_offset), etag: etag(row),
    });
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > TICKET_ATTACHMENT_LIMITS.chunkBytes) throw uploadError("Cada parte do upload pode ter no máximo 8 MB.", 413, "ATTACHMENT_CHUNK_TOO_LARGE");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength <= 0) throw uploadError("Parte do upload vazia.", 400, "ATTACHMENT_CHUNK_EMPTY");
  if (bytes.byteLength > TICKET_ATTACHMENT_LIMITS.chunkBytes) throw uploadError("Cada parte do upload pode ter no máximo 8 MB.", 413, "ATTACHMENT_CHUNK_TOO_LARGE");
  const nextOffset = offset + bytes.byteLength;
  if (nextOffset > Number(row.expected_size)) throw uploadError("O conteúdo ultrapassa o tamanho declarado.", 409, "ATTACHMENT_UPLOAD_SIZE_MISMATCH");
  if (offset === 0) assertTicketAttachmentFirstChunk(row.original_name, bytes);
  if (!row.provider_session_id) throw uploadError("Sessão do provedor indisponível.", 409, "ATTACHMENT_UPLOAD_SESSION_INVALID");

  if (nextOffset < Number(row.expected_size)) {
    const providerOffset = await appendWithReconciliation(env, row.provider_session_id, offset, bytes);
    row = await advanceOffset(env, row, providerOffset, "UPLOADING");
    return { session: publicSession(row, row), attachment: null, complete: false };
  }

  // The final chunk first transitions locally to FINALIZING, then provider commit
  // is reconciled and the D1 publication is atomic.
  const finalizingResult = await getDb(env).prepare(`UPDATE ticket_attachment_upload_sessions
    SET state='FINALIZING', version=version+1, updated_at=?
    WHERE id=? AND version=? AND acknowledged_offset=? AND state='UPLOADING'`)
    .bind(nowIso(), row.id, row.version, row.acknowledged_offset).run();
  if (changes(finalizingResult) === 1) row = await loadSession(env, row.organization_id, row.ticket_id, row.id);
  else {
    const current = await loadSession(env, row.organization_id, row.ticket_id, row.id);
    if (!current || !["FINALIZING", "RECONCILE"].includes(current.state)) {
      throw uploadError("A sessão mudou antes da finalização.", 409, "ATTACHMENT_UPLOAD_CONFLICT");
    }
    row = current;
  }

  try {
    const metadata = await finishWithReconciliation(env, row, offset, bytes);
    if (!metadataMatches(metadata, row)) throw uploadError("A integridade do arquivo final não foi confirmada.", 409, "ATTACHMENT_UPLOAD_INTEGRITY_MISMATCH");
    // Keep the provider-confirmed final offset in the same publish batch.
    const rowForPublish = { ...row, acknowledged_offset: Number(row.expected_size) };
    const attachment = await publishCompleted(env, rowForPublish, metadata, user, request);
    const completed = await loadSession(env, row.organization_id, row.ticket_id, row.id);
    return { session: publicSession(completed, attachment), attachment: publicTicketAttachment(attachment), complete: true };
  } catch (error) {
    try {
      await getDb(env).prepare(`UPDATE ticket_attachment_upload_sessions
        SET state='RECONCILE', version=version+1, last_error_code=?, last_error_at=?, updated_at=?
        WHERE id=? AND state='FINALIZING'`)
        .bind(String(error?.code || "ATTACHMENT_UPLOAD_FINALIZE_FAILED").slice(0,120), nowIso(), nowIso(), row.id).run();
    } catch (stateError) {
      console.error("[Maono CC-06][finalize reconcile state]", stateError);
    }
    throw error;
  }
}

export async function reconcileTicketAttachmentUpload(env, context, uploadId, user, request) {
  await assertTicketResumableUploadReady(env);
  let row = assertSessionContext(
    await loadSession(env, context.organizationId, context.ticketId, uploadId),
    context,
    { mutation: true },
  );
  if (row.state !== "RECONCILE") return { session: publicSession(row, row), attachment: null, complete: false };
  const metadata = await committedMetadata(env, row);
  if (!metadata) throw uploadError("O arquivo ainda não foi confirmado no provedor.", 409, "ATTACHMENT_UPLOAD_RECONCILE_PENDING");
  const attachment = await publishCompleted(env, { ...row, acknowledged_offset: Number(row.expected_size) }, metadata, user, request);
  row = await loadSession(env, row.organization_id, row.ticket_id, row.id);
  return { session: publicSession(row, attachment), attachment: publicTicketAttachment(attachment), complete: true };
}

export async function cancelTicketAttachmentUpload(env, context, uploadId, reason = "Upload cancelado pelo usuário.") {
  await assertTicketResumableUploadReady(env);
  const row = assertSessionContext(
    await loadSession(env, context.organizationId, context.ticketId, uploadId),
    context,
    { mutation: false },
  );
  const timestamp = nowIso();
  const db = getDb(env);
  const results = await db.batch([
    db.prepare(`UPDATE ticket_attachment_upload_sessions
      SET state='CANCELLED', version=version+1, cancelled_at=?, last_error_code='ATTACHMENT_UPLOAD_CANCELLED', last_error_at=?, updated_at=?
      WHERE id=? AND version=? AND state IN ('RESERVED','UPLOADING','RECONCILE')`)
      .bind(timestamp, timestamp, timestamp, row.id, row.version),
    db.prepare(`UPDATE ticket_attachments
      SET status='FAILED', error_message=?, deleted_at=COALESCE(deleted_at,?), updated_at=?
      WHERE upload_session_id=? AND status='PENDING'`)
      .bind(String(reason).slice(0,1000), timestamp, timestamp, row.id),
  ]);
  if (changes(results?.[0]) !== 1) throw uploadError("A sessão mudou antes do cancelamento.", 409, "ATTACHMENT_UPLOAD_CONFLICT");
  return { cancelled: true };
}

export async function cancelTicketAttachmentUploadByAttachment(env, context, attachmentId) {
  const row = await loadSessionByAttachment(env, context.organizationId, context.ticketId, attachmentId);
  if (!row) return false;
  await cancelTicketAttachmentUpload(env, context, row.id);
  return true;
}
