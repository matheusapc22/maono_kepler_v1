/**
 * CC-05A pure contracts. No database writes, role shortcuts, browser storage or
 * implicit authorization. Callers MUST obtain capabilities from the canonical
 * server resolver and validate the ticket ACL on every request/retry.
 * This module is NOT yet wired into product routes: see CC-05 execution status.
 */
export const TICKET_CONVERSATION_LIMITS = Object.freeze({
  bodyCharacters: 20000, reasonCharacters: 1000, defaultPageSize: 30, maxPageSize: 100,
});
export const TICKET_NOTE_PERMISSIONS = Object.freeze({ view: 'ticket.note.view', create: 'ticket.note.create' });
const AUDIENCES = new Set(['ticket', 'internal']);
const IDENTIFIER = /^[a-zA-Z0-9_-]{1,120}$/;

export function conversationError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}
export function conversationAudience(kind) {
  if (kind === 'response') return 'ticket';
  if (kind === 'internal') return 'internal';
  throw conversationError('TICKET_MESSAGE_KIND_INVALID');
}
export function conversationIdentifier(value) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw conversationError('TICKET_CONVERSATION_ID_INVALID');
  return value;
}
function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}
function validContext(context) {
  return context?.authenticated === true && context?.ticketView === true
    && positiveId(context.organizationId) && positiveId(context.ticketId) && positiveId(context.userId);
}
function sameScope(context, row) {
  return validContext(context) && Number(row?.organization_id) === context.organizationId
    && Number(row?.ticket_id) === context.ticketId;
}
function audienceAllowed(context, audience) {
  return audience === 'ticket' || (audience === 'internal' && context.noteView === true);
}
export function canReadConversation(context, message) {
  return sameScope(context, message) && AUDIENCES.has(message?.audience)
    && ((message.kind === 'response' && message.audience === 'ticket')
      || (message.kind === 'internal' && message.audience === 'internal'))
    && audienceAllowed(context, message.audience);
}
export function canWriteConversation(context, audience) {
  return validContext(context) && context.ticketComment === true && context.ticketClosed === false
    && AUDIENCES.has(audience) && audienceAllowed(context, audience)
    && (audience !== 'internal' || context.noteCreate === true);
}
export function canEditConversation(context, message) {
  return canReadConversation(context, message) && canWriteConversation(context, message.audience)
    && Number(message.author_user_id) === context.userId;
}
export function canReadDraft(context, draft) {
  return sameScope(context, draft) && draft.state === 'active' && Number(draft.user_id) === context.userId
    && AUDIENCES.has(draft.audience) && audienceAllowed(context, draft.audience)
    && context.ticketComment === true && (draft.audience !== 'internal' || context.noteCreate === true);
}
export function canReadConversationAttachment(context, attachment, { message = null, draft = null } = {}) {
  if (!sameScope(context, attachment) || attachment.status !== 'ACTIVE') return false;
  if (attachment.audience === 'draft') {
    return attachment.message_id == null && typeof attachment.draft_id === 'string'
      && draft?.id === attachment.draft_id && canReadDraft(context, draft)
      && Number(attachment.uploaded_by) === context.userId;
  }
  if (attachment.draft_id != null) return false;
  if (attachment.message_id != null) {
    return message?.id === attachment.message_id && attachment.audience === message?.audience
      && canReadConversation(context, message);
  }
  // Missing classification is NOT interpreted as legacy. Pre-migration callers
  // must explicitly project legacy rows as audience=ticket after schema detection.
  return attachment.audience === 'ticket';
}
export function canReadConversationEvent(context, event, message = null) {
  if (!sameScope(context, event)) return false;
  if (event.message_id != null) {
    return message?.id === event.message_id && event.audience === message?.audience
      && canReadConversation(context, message);
  }
  return event.audience === 'ticket';
}
function body(value, allowEmpty) {
  if (typeof value !== 'string' || value.includes('\u0000')
    || value.length > TICKET_CONVERSATION_LIMITS.bodyCharacters || (!allowEmpty && !value.trim())) {
    throw conversationError('TICKET_MESSAGE_BODY_INVALID');
  }
  return value.replace(/\r\n?/g, '\n');
}
export function normalizeConversationInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw conversationError('TICKET_MESSAGE_INPUT_INVALID');
  const allowed = new Set(['kind', 'body', 'attachmentIds', 'draftId', 'draftVersion']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw conversationError('TICKET_MESSAGE_FIELD_NOT_ALLOWED');
  const audience = conversationAudience(input.kind);
  const ids = input.attachmentIds ?? [];
  if (!Array.isArray(ids) || ids.length > 5 || ids.some(id => !positiveId(id)) || new Set(ids).size !== ids.length) {
    throw conversationError('TICKET_MESSAGE_ATTACHMENTS_INVALID');
  }
  const hasDraft = input.draftId !== undefined && input.draftId !== null;
  if ((hasDraft && !positiveId(input.draftVersion)) || (!hasDraft && input.draftVersion != null)) {
    throw conversationError('TICKET_DRAFT_VERSION_INVALID');
  }
  if (ids.length && !hasDraft) throw conversationError('TICKET_DRAFT_REQUIRED_FOR_ATTACHMENTS');
  return Object.freeze({ kind: input.kind, audience, body: body(input.body, false),
    attachmentIds: Object.freeze([...ids].sort((a, b) => a - b)),
    draftId: hasDraft ? conversationIdentifier(input.draftId) : null,
    draftVersion: hasDraft ? input.draftVersion : null });
}
export function normalizeDraftBody(value) { return body(value, true); }
export function conversationEtag(resourceId, version) {
  conversationIdentifier(resourceId);
  if (!positiveId(version)) throw conversationError('TICKET_CONVERSATION_VERSION_INVALID');
  return `"cc05:${resourceId}:${version}"`;
}
export function requireConversationVersion(ifMatch, resourceId) {
  conversationIdentifier(resourceId);
  if (ifMatch === null || ifMatch === undefined || ifMatch === '') throw conversationError('PRECONDITION_REQUIRED', 428);
  if (typeof ifMatch !== 'string') throw conversationError('PRECONDITION_FAILED', 412);
  const match = /^"cc05:([a-zA-Z0-9_-]{1,120}):([1-9][0-9]*)"$/.exec(ifMatch);
  const version = match ? Number(match[2]) : NaN;
  if (!match || match[1] !== resourceId || !positiveId(version)) throw conversationError('PRECONDITION_FAILED', 412);
  return version;
}
export function conversationRequestFingerprint(context, input) {
  if (!validContext(context)) throw conversationError('TICKET_NOT_FOUND', 404);
  const normalized = normalizeConversationInput(input);
  // Fixed key order and numeric sort. Hash this server-side before storing it in
  // ticket_commands.request_hash. Never log or persist this plaintext preimage.
  return JSON.stringify({ organizationId: context.organizationId, ticketId: context.ticketId,
    actorUserId: context.userId, ...normalized });
}
export function parseConversationPageSize(value) {
  if (value == null) return TICKET_CONVERSATION_LIMITS.defaultPageSize;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) throw conversationError('TICKET_PAGE_SIZE_INVALID');
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size > TICKET_CONVERSATION_LIMITS.maxPageSize) throw conversationError('TICKET_PAGE_SIZE_INVALID');
  return size;
}
export function draftWriteSql() {
  // Read RETURNING before acknowledging "saved". Zero rows => 412, never success.
  return `UPDATE ticket_drafts SET body = ?, version = version + 1, updated_at = ?
    WHERE id = ? AND organization_id = ? AND ticket_id = ? AND user_id = ?
      AND audience = ? AND state = 'active' AND version = ? RETURNING id, version, updated_at`;
}
export function conversationPublicMetadata(message) {
  // Suitable only AFTER authorization, NOT for a public organization timeline.
  return { messageId: conversationIdentifier(message.id), audience: message.audience, version: message.version };
}
