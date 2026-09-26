import { can } from "./permissions.js";
import { requireTicketAccess } from "./ticket-access.js";
import {
  canEditConversation,
  canReadConversation,
  canReadConversationAttachment,
  canReadDraft,
  canWriteConversation,
  conversationEtag,
  conversationPublicMetadata,
  conversationRequestFingerprint,
  normalizeConversationInput,
  normalizeDraftBody,
  parseConversationPageSize,
  requireConversationVersion,
} from "./ticket-conversation-policy.js";
import {
  getDb,
  getTableColumns,
  tableExists,
} from "./organizations.js";
import { publicTicketAttachment } from "./ticket-center.js";

const REQUIRED_TABLES = Object.freeze([
  "ticket_messages",
  "ticket_message_revisions",
  "ticket_drafts",
  "ticket_commands",
  "ticket_command_outbox",
  "ticket_events",
  "ticket_attachments",
]);
const REQUIRED_MESSAGE_COLUMNS = Object.freeze([
  "id", "organization_id", "ticket_id", "author_user_id", "kind", "audience",
  "body", "version", "command_id", "last_command_id", "created_at", "edited_at", "edit_reason",
]);
const REQUIRED_DRAFT_COLUMNS = Object.freeze([
  "id", "organization_id", "ticket_id", "user_id", "audience", "body", "version",
  "state", "consumed_message_id", "created_at", "updated_at",
]);
const REQUIRED_ATTACHMENT_COLUMNS = Object.freeze(["audience", "message_id", "draft_id"]);
const REQUIRED_EVENT_COLUMNS = Object.freeze(["audience", "message_id"]);
const REQUIRED_TRIGGERS = Object.freeze([
  "cc05_message_initial_revision",
  "cc05_message_edit_revision",
  "cc05_message_no_delete",
  "cc05_revisions_no_update",
  "cc05_revisions_no_delete",
  "cc05_draft_no_delete",
  "cc05_attachment_insert_scope",
  "cc05_attachment_update_scope",
  "cc05_event_message_scope",
]);

function conversationError(message, status = 400, code = "TICKET_CONVERSATION_INVALID") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (status >= 500) error.publicMessage = message;
  return error;
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function safeParse(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical(value))),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parsePositiveId(value, label = "Identificador") {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw conversationError(`${label} inválido.`, 400, "TICKET_CONVERSATION_ID_INVALID");
  }
  return number;
}

function parseResourceId(value, label = "Identificador") {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(text)) {
    throw conversationError(`${label} inválido.`, 400, "TICKET_CONVERSATION_ID_INVALID");
  }
  return text;
}

async function columnsInclude(env, table, expected) {
  try {
    if (!(await tableExists(env, table))) return false;
    const columns = await getTableColumns(env, table);
    return expected.every((column) => columns.has(column));
  } catch {
    return false;
  }
}

export function isTicketConversationsEnabled(env) {
  return String(env?.MAONO_TICKET_CONVERSATIONS_ENABLED || "").trim().toLowerCase() === "true";
}

export async function getTicketConversationReadShape(env) {
  const [attachmentScoped, eventScoped] = await Promise.all([
    columnsInclude(env, "ticket_attachments", REQUIRED_ATTACHMENT_COLUMNS),
    columnsInclude(env, "ticket_events", REQUIRED_EVENT_COLUMNS),
  ]);
  return { attachmentScoped, eventScoped };
}

export async function getTicketConversationCapability(env) {
  const tableResults = await Promise.all(REQUIRED_TABLES.map((table) => tableExists(env, table).catch(() => false)));
  const tablesReady = tableResults.every(Boolean);
  const [messagesReady, draftsReady, attachmentsReady, eventsReady] = await Promise.all([
    columnsInclude(env, "ticket_messages", REQUIRED_MESSAGE_COLUMNS),
    columnsInclude(env, "ticket_drafts", REQUIRED_DRAFT_COLUMNS),
    columnsInclude(env, "ticket_attachments", REQUIRED_ATTACHMENT_COLUMNS),
    columnsInclude(env, "ticket_events", REQUIRED_EVENT_COLUMNS),
  ]);
  let triggersReady = false;
  if (tablesReady) {
    try {
      const result = await getDb(env)
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN (${REQUIRED_TRIGGERS.map(() => "?").join(",")})`)
        .bind(...REQUIRED_TRIGGERS)
        .all();
      const present = new Set((result?.results || []).map((row) => String(row.name)));
      triggersReady = REQUIRED_TRIGGERS.every((name) => present.has(name));
    } catch {
      triggersReady = false;
    }
  }
  const schemaReady = tablesReady && messagesReady && draftsReady && attachmentsReady && eventsReady && triggersReady;
  return {
    configured: isTicketConversationsEnabled(env),
    schemaReady,
    enabled: isTicketConversationsEnabled(env) && schemaReady,
  };
}

export async function assertTicketConversationReady(env) {
  const capability = await getTicketConversationCapability(env);
  if (!capability.configured) {
    throw conversationError(
      "As conversas da Central de Chamados ainda não estão habilitadas neste ambiente.",
      503,
      "TICKET_CONVERSATIONS_DISABLED",
    );
  }
  if (!capability.schemaReady) {
    throw conversationError(
      "As conversas da Central de Chamados estão indisponíveis porque a migration 0028 ainda não foi confirmada neste ambiente.",
      503,
      "TICKET_CONVERSATIONS_SCHEMA_OUTDATED",
    );
  }
  return capability;
}

async function ticketRow(env, organizationId, ticketId) {
  const row = await getDb(env)
    .prepare(`SELECT id, organization_id, status, version, active
      FROM organization_tickets
      WHERE organization_id = ? AND id = ? AND active = 1 LIMIT 1`)
    .bind(organizationId, ticketId)
    .first();
  if (!row) throw conversationError("Chamado não encontrado.", 404, "TICKET_NOT_FOUND");
  return row;
}

async function objectCommentAllowed(env, organizationId, ticketId, user) {
  const decision = await can(env, user, "ticket.comment", {
    organizationId,
    scopeType: "organization",
    resourceType: "ticket",
    resourceId: ticketId,
  });
  if (!decision.allowed) return false;
  try {
    await requireTicketAccess(env, organizationId, ticketId, user, "ticket.comment");
    return true;
  } catch (error) {
    if (error?.status === 403 || error?.status === 404) return false;
    throw error;
  }
}

export async function resolveTicketConversationContext(env, organizationId, ticketId, user, {
  ticketView = true,
} = {}) {
  const ticket = await ticketRow(env, organizationId, ticketId);
  const permissionContext = {
    organizationId,
    scopeType: "organization",
    resourceType: "ticket",
    resourceId: ticketId,
  };
  const [commentAllowed, noteViewDecision, noteCreateDecision] = await Promise.all([
    objectCommentAllowed(env, organizationId, ticketId, user),
    can(env, user, "ticket.note.view", permissionContext),
    can(env, user, "ticket.note.create", permissionContext),
  ]);
  return Object.freeze({
    authenticated: Boolean(user?.id),
    organizationId: Number(organizationId),
    ticketId: Number(ticketId),
    userId: Number(user?.id),
    ticketView: Boolean(ticketView),
    ticketComment: Boolean(commentAllowed),
    ticketClosed: String(ticket.status) === "closed",
    noteView: Boolean(noteViewDecision.allowed),
    noteCreate: Boolean(noteViewDecision.allowed && noteCreateDecision.allowed),
  });
}

function publicAuthor(row, prefix = "author") {
  const actorId = row[`${prefix}_id`] ?? row.author_user_id ?? row.editor_user_id ?? null;
  if (actorId == null) return null;
  return {
    id: actorId,
    name: row[`${prefix}_name`] || null,
    email: row[`${prefix}_email`] || null,
  };
}

function publicMessage(row, attachments = []) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    ticketId: row.ticket_id,
    kind: row.kind,
    audience: row.audience,
    body: row.body,
    version: Number(row.version || 1),
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    editReason: row.edit_reason || null,
    author: publicAuthor(row),
    attachments,
    etag: conversationEtag(row.id, Number(row.version || 1)),
  };
}

function publicDraft(row, attachments = []) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    ticketId: row.ticket_id,
    audience: row.audience,
    kind: row.audience === "internal" ? "internal" : "response",
    body: row.body || "",
    version: Number(row.version || 1),
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments,
    etag: conversationEtag(row.id, Number(row.version || 1)),
  };
}

function encodeCursor(row) {
  const raw = `${row.created_at}\n${row.id}`;
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeCursor(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!/^[A-Za-z0-9_-]{1,500}$/.test(text)) {
    throw conversationError("Cursor de conversa inválido.", 400, "TICKET_CONVERSATION_CURSOR_INVALID");
  }
  try {
    const padded = text.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((text.length + 3) % 4);
    const [createdAt, resourceId, ...rest] = atob(padded).split("\n");
    if (rest.length || !createdAt || Number.isNaN(new Date(createdAt).getTime())) throw new Error("invalid");
    return { createdAt, id: parseResourceId(resourceId, "Cursor") };
  } catch (error) {
    if (error?.code === "TICKET_CONVERSATION_ID_INVALID") throw error;
    throw conversationError("Cursor de conversa inválido.", 400, "TICKET_CONVERSATION_CURSOR_INVALID");
  }
}

async function attachmentsForMessages(env, organizationId, ticketId, messageIds) {
  if (!messageIds.length) return new Map();
  const placeholders = messageIds.map(() => "?").join(",");
  const result = await getDb(env)
    .prepare(`SELECT a.*, uploader.id AS uploader_id, uploader.name AS uploader_name, uploader.email AS uploader_email
      FROM ticket_attachments a
      LEFT JOIN users uploader ON uploader.id = a.uploaded_by
      WHERE a.organization_id = ? AND a.ticket_id = ? AND a.status = 'ACTIVE' AND a.deleted_at IS NULL
        AND a.message_id IN (${placeholders})
      ORDER BY a.created_at, a.id`)
    .bind(organizationId, ticketId, ...messageIds)
    .all();
  const grouped = new Map();
  for (const row of result?.results || []) {
    const key = String(row.message_id);
    const current = grouped.get(key) || [];
    current.push({ ...publicTicketAttachment(row), audience: row.audience, messageId: row.message_id });
    grouped.set(key, current);
  }
  return grouped;
}

async function attachmentsForDraft(env, organizationId, ticketId, draftId, userId) {
  const result = await getDb(env)
    .prepare(`SELECT a.*, uploader.id AS uploader_id, uploader.name AS uploader_name, uploader.email AS uploader_email
      FROM ticket_attachments a
      LEFT JOIN users uploader ON uploader.id = a.uploaded_by
      WHERE a.organization_id = ? AND a.ticket_id = ? AND a.draft_id = ? AND a.uploaded_by = ?
        AND a.audience = 'draft' AND a.status = 'ACTIVE' AND a.deleted_at IS NULL
      ORDER BY a.created_at, a.id`)
    .bind(organizationId, ticketId, draftId, userId)
    .all();
  return (result?.results || []).map((row) => ({ ...publicTicketAttachment(row), audience: "draft", draftId: row.draft_id }));
}

export async function listTicketMessages(env, context, {
  limit = null,
  cursor = null,
} = {}) {
  await assertTicketConversationReady(env);
  if (!context?.ticketView) throw conversationError("Chamado não encontrado.", 404, "TICKET_NOT_FOUND");
  const pageSize = parseConversationPageSize(limit == null ? null : String(limit));
  const before = decodeCursor(cursor);
  const values = [context.organizationId, context.ticketId];
  const where = ["m.organization_id = ?", "m.ticket_id = ?"];
  if (!context.noteView) where.push("m.audience = 'ticket'");
  if (before) {
    where.push("(m.created_at < ? OR (m.created_at = ? AND m.id < ?))");
    values.push(before.createdAt, before.createdAt, before.id);
  }
  const result = await getDb(env)
    .prepare(`SELECT m.*, author.id AS author_id, author.name AS author_name, author.email AS author_email
      FROM ticket_messages m
      LEFT JOIN users author ON author.id = m.author_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?`)
    .bind(...values, pageSize + 1)
    .all();
  const rows = result?.results || [];
  const hasMore = rows.length > pageSize;
  const selected = rows.slice(0, pageSize).filter((row) => canReadConversation(context, row));
  const grouped = await attachmentsForMessages(env, context.organizationId, context.ticketId, selected.map((row) => row.id));
  return {
    messages: selected.slice().reverse().map((row) => publicMessage(row, grouped.get(String(row.id)) || [])),
    nextCursor: hasMore && selected.length ? encodeCursor(selected.at(-1)) : null,
    hasMore,
  };
}

async function activeDraftRows(env, context) {
  const result = await getDb(env)
    .prepare(`SELECT * FROM ticket_drafts
      WHERE organization_id = ? AND ticket_id = ? AND user_id = ? AND state = 'active'
      ORDER BY audience`)
    .bind(context.organizationId, context.ticketId, context.userId)
    .all();
  return result?.results || [];
}

export async function listTicketDrafts(env, context) {
  await assertTicketConversationReady(env);
  const output = [];
  for (const row of await activeDraftRows(env, context)) {
    if (!canReadDraft(context, row)) continue;
    output.push(publicDraft(
      row,
      await attachmentsForDraft(env, context.organizationId, context.ticketId, row.id, context.userId),
    ));
  }
  return output;
}

export async function readTicketConversationBundle(env, context, { limit = 30 } = {}) {
  const capability = await getTicketConversationCapability(env);
  const permissions = {
    comment: Boolean(context.ticketComment),
    noteView: Boolean(context.noteView),
    noteCreate: Boolean(context.noteCreate),
  };
  if (!capability.enabled) {
    return {
      enabled: false,
      schemaReady: capability.schemaReady,
      permissions,
      messages: [],
      drafts: [],
      nextCursor: null,
      hasMore: false,
    };
  }
  const [page, drafts] = await Promise.all([
    listTicketMessages(env, context, { limit }),
    listTicketDrafts(env, context),
  ]);
  return { enabled: true, schemaReady: true, permissions, ...page, drafts };
}

export async function createTicketDraft(env, context, payload = {}) {
  await assertTicketConversationReady(env);
  const kind = payload.kind === "internal" ? "internal" : payload.kind === "response" ? "response" : null;
  if (!kind) throw conversationError("Escolha resposta ou nota interna.", 400, "TICKET_CONVERSATION_KIND_INVALID");
  const audience = kind === "internal" ? "internal" : "ticket";
  if (!canWriteConversation(context, audience)) {
    throw conversationError("Você não pode escrever neste chamado.", 403, "TICKET_CONVERSATION_WRITE_FORBIDDEN");
  }
  const body = normalizeDraftBody(payload.body ?? "");
  const existing = await getDb(env)
    .prepare(`SELECT * FROM ticket_drafts
      WHERE organization_id = ? AND ticket_id = ? AND user_id = ? AND audience = ? AND state = 'active' LIMIT 1`)
    .bind(context.organizationId, context.ticketId, context.userId, audience)
    .first();
  if (existing) {
    if (!canReadDraft(context, existing)) throw conversationError("Rascunho não encontrado.", 404, "TICKET_DRAFT_NOT_FOUND");
    return publicDraft(existing, await attachmentsForDraft(env, context.organizationId, context.ticketId, existing.id, context.userId));
  }
  const draftId = id("draft");
  const timestamp = nowIso();
  try {
    await getDb(env).prepare(`INSERT INTO ticket_drafts
      (id, organization_id, ticket_id, user_id, audience, body, version, state, consumed_message_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 'active', NULL, ?, ?)`)
      .bind(draftId, context.organizationId, context.ticketId, context.userId, audience, body, timestamp, timestamp)
      .run();
  } catch (error) {
    const winner = await getDb(env)
      .prepare(`SELECT * FROM ticket_drafts
        WHERE organization_id = ? AND ticket_id = ? AND user_id = ? AND audience = ? AND state = 'active' LIMIT 1`)
      .bind(context.organizationId, context.ticketId, context.userId, audience)
      .first();
    if (winner && canReadDraft(context, winner)) return publicDraft(winner, await attachmentsForDraft(env, context.organizationId, context.ticketId, winner.id, context.userId));
    throw error;
  }
  const created = await getDb(env).prepare("SELECT * FROM ticket_drafts WHERE id = ? LIMIT 1").bind(draftId).first();
  return publicDraft(created, []);
}

async function draftOrThrow(env, context, draftId) {
  const resourceId = parseResourceId(draftId, "Rascunho");
  const row = await getDb(env).prepare("SELECT * FROM ticket_drafts WHERE id = ? LIMIT 1").bind(resourceId).first();
  if (!row || !canReadDraft(context, row)) throw conversationError("Rascunho não encontrado.", 404, "TICKET_DRAFT_NOT_FOUND");
  return row;
}

export async function getTicketDraft(env, context, draftId) {
  await assertTicketConversationReady(env);
  const row = await draftOrThrow(env, context, draftId);
  return publicDraft(row, await attachmentsForDraft(env, context.organizationId, context.ticketId, row.id, context.userId));
}

export async function updateTicketDraft(env, context, draftId, payload, ifMatch) {
  await assertTicketConversationReady(env);
  const current = await draftOrThrow(env, context, draftId);
  if (!canWriteConversation(context, current.audience)) throw conversationError("Você não pode alterar este rascunho.", 403, "TICKET_DRAFT_WRITE_FORBIDDEN");
  const expectedVersion = requireConversationVersion(ifMatch, current.id);
  if (expectedVersion !== Number(current.version)) throw conversationError("O rascunho mudou. Recarregue antes de salvar novamente.", 412, "TICKET_DRAFT_VERSION_CONFLICT");
  const body = normalizeDraftBody(payload?.body ?? "");
  const updatedAt = nowIso();
  const updated = await getDb(env)
    .prepare(`UPDATE ticket_drafts SET body = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND organization_id = ? AND ticket_id = ? AND user_id = ? AND state = 'active' AND version = ?
      RETURNING *`)
    .bind(body, updatedAt, current.id, context.organizationId, context.ticketId, context.userId, expectedVersion)
    .first();
  if (!updated) throw conversationError("O rascunho mudou. Recarregue antes de salvar novamente.", 412, "TICKET_DRAFT_VERSION_CONFLICT");
  return publicDraft(updated, await attachmentsForDraft(env, context.organizationId, context.ticketId, updated.id, context.userId));
}

export async function discardTicketDraft(env, context, draftId, ifMatch) {
  await assertTicketConversationReady(env);
  const current = await draftOrThrow(env, context, draftId);
  const expectedVersion = requireConversationVersion(ifMatch, current.id);
  if (expectedVersion !== Number(current.version)) throw conversationError("O rascunho mudou. Recarregue antes de descartá-lo.", 412, "TICKET_DRAFT_VERSION_CONFLICT");
  const result = await getDb(env)
    .prepare(`UPDATE ticket_drafts SET state = 'discarded', version = version + 1, updated_at = ?
      WHERE id = ? AND organization_id = ? AND ticket_id = ? AND user_id = ? AND state = 'active' AND version = ?`)
    .bind(nowIso(), current.id, context.organizationId, context.ticketId, context.userId, expectedVersion)
    .run();
  if (Number(result?.meta?.changes || 0) !== 1) throw conversationError("O rascunho mudou. Recarregue antes de descartá-lo.", 412, "TICKET_DRAFT_VERSION_CONFLICT");
  return true;
}

async function messageRow(env, context, messageId) {
  const resourceId = parseResourceId(messageId, "Mensagem");
  const row = await getDb(env)
    .prepare(`SELECT m.*, author.id AS author_id, author.name AS author_name, author.email AS author_email
      FROM ticket_messages m LEFT JOIN users author ON author.id = m.author_user_id
      WHERE m.id = ? LIMIT 1`)
    .bind(resourceId)
    .first();
  if (!row || !canReadConversation(context, row)) throw conversationError("Mensagem não encontrada.", 404, "TICKET_MESSAGE_NOT_FOUND");
  return row;
}

async function messageWithAttachments(env, context, messageId) {
  const row = await messageRow(env, context, messageId);
  const grouped = await attachmentsForMessages(env, context.organizationId, context.ticketId, [row.id]);
  return publicMessage(row, grouped.get(String(row.id)) || []);
}

async function priorCommand(env, context, operation, key) {
  return getDb(env)
    .prepare(`SELECT * FROM ticket_commands
      WHERE organization_id = ? AND actor_user_id = ? AND operation = ? AND idempotency_key = ? LIMIT 1`)
    .bind(context.organizationId, context.userId, operation, key)
    .first();
}

function idempotencyKey(request) {
  const key = String(request?.headers?.get("Idempotency-Key") || "").trim();
  if (!key) throw conversationError("Recarregue o compositor antes de tentar novamente.", 400, "TICKET_CONVERSATION_IDEMPOTENCY_KEY_REQUIRED");
  if (key.length > 200) throw conversationError("A identificação desta tentativa é inválida.", 400, "TICKET_CONVERSATION_IDEMPOTENCY_KEY_INVALID");
  return key;
}

async function draftAttachmentsForSend(env, context, input, draft) {
  if (!input.attachmentIds.length) return [];
  if (!draft) throw conversationError("Anexos de conversa precisam estar vinculados a um rascunho ativo.", 409, "TICKET_MESSAGE_DRAFT_REQUIRED");
  const placeholders = input.attachmentIds.map(() => "?").join(",");
  const result = await getDb(env)
    .prepare(`SELECT * FROM ticket_attachments
      WHERE organization_id = ? AND ticket_id = ? AND id IN (${placeholders})
        AND status = 'ACTIVE' AND deleted_at IS NULL AND audience = 'draft'
        AND draft_id = ? AND message_id IS NULL AND uploaded_by = ?`)
    .bind(context.organizationId, context.ticketId, ...input.attachmentIds, draft.id, context.userId)
    .all();
  const rows = result?.results || [];
  const found = new Set(rows.map((row) => Number(row.id)));
  if (rows.length !== input.attachmentIds.length || input.attachmentIds.some((attachmentId) => !found.has(Number(attachmentId)))) {
    throw conversationError("Um ou mais anexos não pertencem a este rascunho.", 409, "TICKET_MESSAGE_ATTACHMENT_SCOPE_INVALID");
  }
  return rows;
}

function auditDetails({ context, action, resourceId, commandId, audience, version, attachmentIds = [] }) {
  return JSON.stringify({
    organizationId: context.organizationId,
    resourceType: "ticket_message",
    resourceId,
    commandId,
    result: "success",
    metadata: {
      ticketId: context.ticketId,
      audience,
      version,
      attachmentIds,
      action,
    },
  });
}

export async function createTicketMessage(env, context, payload, request) {
  await assertTicketConversationReady(env);
  const input = normalizeConversationInput(payload);
  if (!canWriteConversation(context, input.audience)) {
    throw conversationError("Você não pode publicar esta mensagem.", 403, "TICKET_CONVERSATION_WRITE_FORBIDDEN");
  }
  const key = idempotencyKey(request);
  const fingerprint = await sha256({
    policy: conversationRequestFingerprint(context, {
      kind: input.kind, body: input.body, attachmentIds: [...input.attachmentIds],
      draftId: input.draftId, draftVersion: input.draftVersion,
    }),
    attachmentIds: input.attachmentIds,
  });
  const operation = "ticket.message.created";
  const replay = async (command) => {
    if (command.request_hash !== fingerprint) throw conversationError("Esta tentativa já foi usada com outro conteúdo.", 409, "TICKET_CONVERSATION_IDEMPOTENCY_KEY_REUSED");
    const result = safeParse(command.result_json, {});
    if (!result?.messageId) throw conversationError("Receipt de conversa inválido.", 500, "TICKET_CONVERSATION_RECEIPT_INVALID");
    return { message: await messageWithAttachments(env, context, result.messageId), replayed: true };
  };
  const existing = await priorCommand(env, context, operation, key);
  if (existing) return replay(existing);

  let draft = null;
  if (input.draftId) {
    draft = await draftOrThrow(env, context, input.draftId);
    if (Number(draft.version) !== Number(input.draftVersion)) throw conversationError("O rascunho mudou antes do envio.", 412, "TICKET_DRAFT_VERSION_CONFLICT");
    if (draft.audience !== input.audience || draft.body !== input.body) throw conversationError("O conteúdo enviado não corresponde ao rascunho atual.", 409, "TICKET_MESSAGE_DRAFT_MISMATCH");
  }
  const attachmentRows = await draftAttachmentsForSend(env, context, input, draft);
  const db = getDb(env);
  const commandId = id("cmd");
  const messageId = id("msg");
  const outboxId = id("outbox");
  const timestamp = nowIso();
  const messageResult = JSON.stringify({ messageId, audience: input.audience, version: 1 });
  const eventType = input.audience === "internal" ? "ticket.note.created" : "ticket.message.created";
  const eventMetadata = JSON.stringify(conversationPublicMetadata({ id: messageId, audience: input.audience, version: 1 }));
  const statements = [
    db.prepare(`INSERT INTO ticket_commands
      (id, organization_id, actor_user_id, operation, idempotency_key, request_hash, result_json, response_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 201, ?)`)
      .bind(commandId, context.organizationId, context.userId, operation, key, fingerprint, messageResult, timestamp),
    db.prepare(`INSERT INTO ticket_messages
      (id, organization_id, ticket_id, author_user_id, kind, audience, body, version, command_id, last_command_id, created_at)
      SELECT ?, t.organization_id, t.id, ?, ?, ?, ?, 1, ?, ?, ?
      FROM organization_tickets t
      WHERE t.organization_id = ? AND t.id = ? AND t.active = 1 AND t.status <> 'closed'`)
      .bind(messageId, context.userId, input.kind, input.audience, input.body, commandId, commandId, timestamp,
        context.organizationId, context.ticketId),
    db.prepare(`INSERT INTO ticket_commands
      SELECT * FROM ticket_commands WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM ticket_messages m WHERE m.id = ? AND m.command_id = ?)`)
      .bind(commandId, messageId, commandId),
  ];
  for (const attachment of attachmentRows) {
    statements.push(db.prepare(`UPDATE ticket_attachments
      SET audience = ?, message_id = ?, draft_id = NULL, updated_at = ?
      WHERE id = ? AND organization_id = ? AND ticket_id = ? AND audience = 'draft'
        AND draft_id = ? AND uploaded_by = ? AND status = 'ACTIVE' AND deleted_at IS NULL`)
      .bind(input.audience, messageId, timestamp, attachment.id, context.organizationId, context.ticketId, draft.id, context.userId));
  }
  if (attachmentRows.length) {
    const placeholders = attachmentRows.map(() => "?").join(",");
    statements.push(db.prepare(`INSERT INTO ticket_commands SELECT * FROM ticket_commands WHERE id = ?
      AND (SELECT COUNT(*) FROM ticket_attachments WHERE message_id = ? AND id IN (${placeholders})) <> ?`)
      .bind(commandId, messageId, ...attachmentRows.map((attachment) => attachment.id), attachmentRows.length));
  }
  if (draft) {
    statements.push(db.prepare(`UPDATE ticket_drafts
      SET state = 'sent', consumed_message_id = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND organization_id = ? AND ticket_id = ? AND user_id = ? AND state = 'active' AND version = ?`)
      .bind(messageId, timestamp, draft.id, context.organizationId, context.ticketId, context.userId, input.draftVersion));
    statements.push(db.prepare(`INSERT INTO ticket_commands SELECT * FROM ticket_commands WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM ticket_drafts WHERE id = ? AND state = 'sent'
        AND consumed_message_id = ? AND version = ?)`)
      .bind(commandId, draft.id, messageId, Number(input.draftVersion) + 1));
  }
  statements.push(
    db.prepare(`INSERT INTO ticket_events
      (organization_id, ticket_id, event_type, actor_user_id, metadata, created_at, command_id, entity_version, audience, message_id)
      SELECT ?, ?, ?, ?, ?, ?, ?, t.version, ?, ?
      FROM organization_tickets t WHERE t.organization_id = ? AND t.id = ? AND t.active = 1`)
      .bind(context.organizationId, context.ticketId, eventType, context.userId, eventMetadata, timestamp, commandId,
        input.audience, messageId, context.organizationId, context.ticketId),
    db.prepare(`INSERT INTO audit_logs(user_id, project_id, action, details, created_at)
      VALUES (?, NULL, ?, ?, ?)`)
      .bind(context.userId, eventType, auditDetails({ context, action: eventType, resourceId: messageId, commandId,
        audience: input.audience, version: 1, attachmentIds: input.attachmentIds }), timestamp),
    db.prepare(`INSERT INTO ticket_command_outbox
      (id, command_id, organization_id, ticket_id, event_id, event_type, payload, status, created_at)
      SELECT ?, ?, ?, ?, e.id, ?, json_object('eventId', e.id, 'ticketId', ?, 'messageId', ?, 'audience', ?), 'pending', ?
      FROM ticket_events e WHERE e.command_id = ? AND e.message_id = ? LIMIT 1`)
      .bind(outboxId, commandId, context.organizationId, context.ticketId, eventType, context.ticketId, messageId,
        input.audience, timestamp, commandId, messageId),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    const winner = await priorCommand(env, context, operation, key);
    if (winner) return replay(winner);
    throw error;
  }
  return { message: await messageWithAttachments(env, context, messageId), replayed: false };
}

export async function editTicketMessage(env, context, messageId, payload, request) {
  await assertTicketConversationReady(env);
  const current = await messageRow(env, context, messageId);
  if (!canEditConversation(context, current)) throw conversationError("Você não pode editar esta mensagem.", 403, "TICKET_MESSAGE_EDIT_FORBIDDEN");
  const expectedVersion = requireConversationVersion(request?.headers?.get("If-Match"), current.id);
  if (expectedVersion !== Number(current.version)) throw conversationError("A mensagem mudou. Recarregue antes de editar.", 412, "TICKET_MESSAGE_VERSION_CONFLICT");
  const normalized = normalizeConversationInput({ kind: current.kind, body: payload?.body });
  const reason = String(payload?.reason ?? "").trim();
  if (!reason || reason.length > 1000) throw conversationError("Informe o motivo da edição em até 1.000 caracteres.", 400, "TICKET_MESSAGE_EDIT_REASON_REQUIRED");
  if (normalized.body === current.body) throw conversationError("A mensagem não foi alterada.", 409, "TICKET_MESSAGE_EDIT_EMPTY");
  const key = idempotencyKey(request);
  const operation = "ticket.message.edited";
  const fingerprint = await sha256({
    organizationId: context.organizationId,
    ticketId: context.ticketId,
    userId: context.userId,
    messageId: current.id,
    expectedVersion,
    body: normalized.body,
    reason,
  });
  const replay = async (command) => {
    if (command.request_hash !== fingerprint) throw conversationError("Esta tentativa já foi usada com outro conteúdo.", 409, "TICKET_CONVERSATION_IDEMPOTENCY_KEY_REUSED");
    const result = safeParse(command.result_json, {});
    return { message: await messageWithAttachments(env, context, result.messageId || current.id), replayed: true };
  };
  const existing = await priorCommand(env, context, operation, key);
  if (existing) return replay(existing);

  const db = getDb(env);
  const commandId = id("cmd");
  const outboxId = id("outbox");
  const timestamp = nowIso();
  const nextVersion = expectedVersion + 1;
  const eventType = current.audience === "internal" ? "ticket.note.edited" : "ticket.message.edited";
  const resultJson = JSON.stringify({ messageId: current.id, audience: current.audience, version: nextVersion });
  const eventMetadata = JSON.stringify(conversationPublicMetadata({ id: current.id, audience: current.audience, version: nextVersion }));
  const statements = [
    db.prepare(`INSERT INTO ticket_commands
      (id, organization_id, actor_user_id, operation, idempotency_key, request_hash, result_json, response_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 200, ?)`)
      .bind(commandId, context.organizationId, context.userId, operation, key, fingerprint, resultJson, timestamp),
    db.prepare(`UPDATE ticket_messages
      SET body = ?, version = version + 1, last_command_id = ?, edited_at = ?, edit_reason = ?
      WHERE id = ? AND organization_id = ? AND ticket_id = ? AND author_user_id = ? AND version = ?`)
      .bind(normalized.body, commandId, timestamp, reason, current.id, context.organizationId, context.ticketId, context.userId, expectedVersion),
    db.prepare(`INSERT INTO ticket_commands SELECT * FROM ticket_commands WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM ticket_messages m WHERE m.id = ? AND m.version = ? AND m.last_command_id = ?)`)
      .bind(commandId, current.id, nextVersion, commandId),
    db.prepare(`INSERT INTO ticket_events
      (organization_id, ticket_id, event_type, actor_user_id, metadata, created_at, command_id, entity_version, audience, message_id)
      SELECT ?, ?, ?, ?, ?, ?, ?, t.version, ?, ? FROM organization_tickets t
      WHERE t.organization_id = ? AND t.id = ? AND t.active = 1
        AND EXISTS (SELECT 1 FROM ticket_messages m WHERE m.id = ? AND m.version = ? AND m.last_command_id = ?)`)
      .bind(context.organizationId, context.ticketId, eventType, context.userId, eventMetadata, timestamp, commandId,
        current.audience, current.id, context.organizationId, context.ticketId, current.id, nextVersion, commandId),
    db.prepare(`INSERT INTO audit_logs(user_id, project_id, action, details, created_at)
      SELECT ?, NULL, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ticket_messages m WHERE m.id = ? AND m.version = ? AND m.last_command_id = ?)`)
      .bind(context.userId, eventType, auditDetails({ context, action: eventType, resourceId: current.id, commandId,
        audience: current.audience, version: nextVersion }), timestamp, current.id, nextVersion, commandId),
    db.prepare(`INSERT INTO ticket_command_outbox
      (id, command_id, organization_id, ticket_id, event_id, event_type, payload, status, created_at)
      SELECT ?, ?, ?, ?, e.id, ?, json_object('eventId', e.id, 'ticketId', ?, 'messageId', ?, 'audience', ?), 'pending', ?
      FROM ticket_events e WHERE e.command_id = ? AND e.message_id = ? LIMIT 1`)
      .bind(outboxId, commandId, context.organizationId, context.ticketId, eventType, context.ticketId, current.id,
        current.audience, timestamp, commandId, current.id),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    const winner = await priorCommand(env, context, operation, key);
    if (winner) return replay(winner);
    throw error;
  }
  const persisted = await getDb(env).prepare("SELECT version, last_command_id FROM ticket_messages WHERE id = ?").bind(current.id).first();
  if (Number(persisted?.version) !== nextVersion || persisted?.last_command_id !== commandId) {
    throw conversationError("A mensagem mudou. Recarregue antes de editar.", 412, "TICKET_MESSAGE_VERSION_CONFLICT");
  }
  return { message: await messageWithAttachments(env, context, current.id), replayed: false };
}

export async function listTicketMessageRevisions(env, context, messageId) {
  await assertTicketConversationReady(env);
  const current = await messageRow(env, context, messageId);
  const result = await getDb(env)
    .prepare(`SELECT r.*, editor.id AS editor_id, editor.name AS editor_name, editor.email AS editor_email
      FROM ticket_message_revisions r
      LEFT JOIN users editor ON editor.id = r.editor_user_id
      WHERE r.message_id = ? AND r.organization_id = ? AND r.ticket_id = ?
      ORDER BY r.version ASC`)
    .bind(current.id, context.organizationId, context.ticketId)
    .all();
  return (result?.results || []).map((row) => ({
    messageId: row.message_id,
    version: Number(row.version),
    body: row.body,
    reason: row.reason || null,
    createdAt: row.created_at,
    editor: publicAuthor(row, "editor"),
  }));
}

export async function assertConversationAttachmentRead(env, context, attachment) {
  const shape = await getTicketConversationReadShape(env);
  if (!shape.attachmentScoped) return true;
  let draft = null;
  let message = null;
  if (attachment?.draft_id) {
    draft = await getDb(env).prepare("SELECT * FROM ticket_drafts WHERE id = ? LIMIT 1").bind(attachment.draft_id).first();
  }
  if (attachment?.message_id) {
    message = await getDb(env).prepare("SELECT * FROM ticket_messages WHERE id = ? LIMIT 1").bind(attachment.message_id).first();
  }
  if (!canReadConversationAttachment(context, attachment, { draft, message })) {
    throw conversationError("Anexo não encontrado.", 404, "ATTACHMENT_NOT_FOUND");
  }
  return true;
}

export async function assertConversationDraftAttachmentWrite(env, context, draftId) {
  await assertTicketConversationReady(env);
  const draft = await draftOrThrow(env, context, draftId);
  if (!canWriteConversation(context, draft.audience)) {
    throw conversationError("Você não pode anexar arquivos a este rascunho.", 403, "TICKET_DRAFT_ATTACHMENT_FORBIDDEN");
  }
  return draft;
}

export async function assertConversationAttachmentMutation(env, context, attachment) {
  const shape = await getTicketConversationReadShape(env);
  if (!shape.attachmentScoped || !attachment?.audience || attachment.audience === "ticket" && !attachment.message_id && !attachment.draft_id) {
    return { conversationScoped: false };
  }
  if (attachment.audience === "draft") {
    const draft = await assertConversationDraftAttachmentWrite(env, context, attachment.draft_id);
    if (String(attachment.uploaded_by) !== String(context.userId) || String(draft.user_id) !== String(context.userId)) {
      throw conversationError("Anexo não encontrado.", 404, "ATTACHMENT_NOT_FOUND");
    }
    return { conversationScoped: true, draft };
  }
  await assertConversationAttachmentRead(env, context, attachment);
  return { conversationScoped: true };
}
