import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canReadConversation, canWriteConversation, canEditConversation, canReadDraft,
  canReadConversationAttachment, canReadConversationEvent, normalizeConversationInput,
  normalizeDraftBody, conversationEtag, requireConversationVersion,
  conversationRequestFingerprint, parseConversationPageSize, conversationPublicMetadata,
} from '../functions/_lib/ticket-conversation-policy.js';

const ctx = { authenticated: true, organizationId: 1, ticketId: 10, userId: 1,
  ticketView: true, ticketComment: true, ticketClosed: false, noteView: true, noteCreate: true };
const msg = { id: 'msg_1', organization_id: 1, ticket_id: 10, author_user_id: 1,
  kind: 'internal', audience: 'internal', body: 'private', version: 1 };
const draft = { id: 'draft_1', organization_id: 1, ticket_id: 10, user_id: 1,
  audience: 'internal', state: 'active' };
const att = { id: 1, organization_id: 1, ticket_id: 10, uploaded_by: 1,
  audience: 'draft', draft_id: 'draft_1', message_id: null, status: 'ACTIVE' };
for (const field of ['authenticated', 'ticketView', 'noteView']) {
  test(`note read fails closed after ${field} revocation`, () => {
    assert.equal(canReadConversation({ ...ctx, [field]: false }, msg), false);
  });
}
for (const field of ['organizationId', 'ticketId']) {
  test(`message and draft reject wrong ${field}`, () => {
    assert.equal(canReadConversation({ ...ctx, [field]: 99 }, msg), false);
    assert.equal(canReadDraft({ ...ctx, [field]: 99 }, draft), false);
  });
}
test('author, requester, assignee and role labels cannot grant note access', () => {
  assert.equal(canReadConversation({ ...ctx, noteView: false, role: 'superadmin', isRequester: true }, msg), false);
});
test('response needs view but no note grant', () => {
  assert.equal(canReadConversation({ ...ctx, noteView: false }, { ...msg, kind: 'response', audience: 'ticket' }), true);
});
test('unknown and incoherent audiences are denied', () => {
  assert.equal(canReadConversation(ctx, { ...msg, audience: 'public' }), false);
  assert.equal(canReadConversation(ctx, { ...msg, kind: 'response' }), false);
});
test('note creation requires both note grants and comment permission', () => {
  for (const field of ['ticketComment', 'noteView', 'noteCreate']) {
    assert.equal(canWriteConversation({ ...ctx, [field]: false }, 'internal'), false);
  }
  assert.equal(canWriteConversation(ctx, 'internal'), true);
});
test('closed or unknown ticket status is not writable', () => {
  assert.equal(canWriteConversation({ ...ctx, ticketClosed: true }, 'ticket'), false);
  assert.equal(canWriteConversation({ ...ctx, ticketClosed: undefined }, 'ticket'), false);
});
test('edits require original author and current write access', () => {
  assert.equal(canEditConversation(ctx, msg), true);
  assert.equal(canEditConversation({ ...ctx, userId: 2 }, msg), false);
  assert.equal(canEditConversation({ ...ctx, ticketComment: false }, msg), false);
});
test('draft never becomes visible to another actor, including role-labelled admin', () => {
  assert.equal(canReadDraft({ ...ctx, userId: 2, role: 'admin' }, draft), false);
  assert.equal(canReadDraft(ctx, { ...draft, state: 'sent' }), false);
});
test('draft access revocation removes access to its attachment', () => {
  assert.equal(canReadConversationAttachment(ctx, att, { draft }), true);
  assert.equal(canReadConversationAttachment({ ...ctx, noteCreate: false }, att, { draft }), false);
  assert.equal(canReadConversationAttachment({ ...ctx, userId: 2 }, att, { draft }), false);
});
test('linked attachment needs matching message, scope and audience', () => {
  const linked = { ...att, audience: 'internal', draft_id: null, message_id: msg.id };
  assert.equal(canReadConversationAttachment(ctx, linked, { message: msg }), true);
  assert.equal(canReadConversationAttachment(ctx, linked), false);
  assert.equal(canReadConversationAttachment(ctx, { ...linked, audience: 'ticket' }, { message: msg }), false);
  assert.equal(canReadConversationAttachment(ctx, linked, { message: { ...msg, ticket_id: 999 } }), false);
  assert.equal(canReadConversationAttachment(ctx, { ...linked, status: 'DELETED' }, { message: msg }), false);
});
test('unclassified or ambiguous attachments fail closed independently of any feature flag', () => {
  const legacy = { ...att, audience: 'ticket', draft_id: null, message_id: null };
  assert.equal(canReadConversationAttachment(ctx, legacy), true);
  assert.equal(canReadConversationAttachment(ctx, { ...legacy, audience: undefined }), false);
  assert.equal(canReadConversationAttachment({ ...ctx, MAONO_TICKET_CONVERSATIONS_ENABLED: false },
    { ...legacy, audience: 'internal' }), false);
  assert.equal(canReadConversationAttachment(ctx, { ...att, message_id: msg.id }, { draft, message: msg }), false);
});
test('event audience must match its message before projection', () => {
  const event = { ...msg, message_id: msg.id };
  assert.equal(canReadConversationEvent(ctx, event, msg), true);
  assert.equal(canReadConversationEvent({ ...ctx, noteView: false }, event, msg), false);
  assert.equal(canReadConversationEvent(ctx, { ...event, audience: 'ticket' }, msg), false);
  assert.equal(canReadConversationEvent(ctx, { ...event, message_id: null }), false);
});
test('payload cannot impersonate author, tenant or choose inconsistent audience', () => {
  for (const key of ['authorUserId', 'organizationId', 'audience', 'version']) {
    assert.throws(() => normalizeConversationInput({ kind: 'internal', body: 'x', [key]: 1 }), /FIELD_NOT_ALLOWED/);
  }
});
test('input normalization preserves body whitespace and sorts stable attachment IDs', () => {
  const normalized = normalizeConversationInput({ kind: 'response', body: ' a\r\nb ', attachmentIds: [2, 1], draftId: 'd1', draftVersion: 1 });
  assert.equal(normalized.body, ' a\nb ');
  assert.equal(normalized.audience, 'ticket');
  assert.deepEqual(normalized.attachmentIds, [1, 2]);
  assert.equal(Object.isFrozen(normalized.attachmentIds), true);
});
for (const value of ['', '  ', 'x'.repeat(20001), 'x\0y', null, {}]) {
  test(`reject invalid message body ${typeof value}:${String(value).slice(0, 15)}`, () => {
    assert.throws(() => normalizeConversationInput({ kind: 'response', body: value }), /BODY_INVALID/);
  });
}
test('empty draft is valid without becoming a message', () => assert.equal(normalizeDraftBody(''), ''));
test('draft and attachments need coherent safe identifiers', () => {
  for (const extra of [ { attachmentIds: [1] }, { attachmentIds: [1, 1], draftId: 'd', draftVersion: 1 },
    { draftId: '../d', draftVersion: 1 }, { draftId: 'd', draftVersion: 0 }, { draftVersion: 1 },
    { attachmentIds: [Number.MAX_SAFE_INTEGER + 1] } ]) {
    assert.throws(() => normalizeConversationInput({ kind: 'response', body: 'x', ...extra }));
  }
});
test('strong resource-specific ETag rejects wildcards, weak tags and cross-resource tags', () => {
  assert.equal(conversationEtag('draft_1', 2), '"cc05:draft_1:2"');
  assert.equal(requireConversationVersion(conversationEtag('draft_1', 2), 'draft_1'), 2);
  for (const value of ['*', 'W/"cc05:draft_1:2"', '"cc05:draft_2:2"', '"cc05:draft_1:9007199254740992"', '"cc05:draft_1:01"']) {
    assert.throws(() => requireConversationVersion(value, 'draft_1'), { status: 412 });
  }
  assert.throws(() => requireConversationVersion(null, 'draft_1'), { status: 428 });
});
test('fingerprint binds tenant, actor, ticket, audience, body and draft version', () => {
  const input = { kind: 'internal', body: 'x', draftId: 'd', draftVersion: 1 };
  const fp = conversationRequestFingerprint(ctx, input);
  for (const field of ['organizationId', 'ticketId', 'userId']) {
    assert.notEqual(conversationRequestFingerprint({ ...ctx, [field]: 99 }, input), fp);
  }
  for (const change of [{ kind: 'response' }, { body: 'y' }, { draftVersion: 2 }]) {
    assert.notEqual(conversationRequestFingerprint(ctx, { ...input, ...change }), fp);
  }
  assert.throws(() => conversationRequestFingerprint({ ...ctx, ticketView: false }, input), { status: 404 });
});
test('pagination is strictly bounded', () => {
  assert.equal(parseConversationPageSize(null), 30);
  assert.equal(parseConversationPageSize('100'), 100);
  for (const value of ['0', '101', '1.5', '10junk', '01', '']) assert.throws(() => parseConversationPageSize(value));
});
test('metadata never includes message body or attachment name', () => {
  assert.deepEqual(conversationPublicMetadata({ ...msg, attachmentName: 'private.txt' }),
    { messageId: msg.id, audience: 'internal', version: 1 });
});
