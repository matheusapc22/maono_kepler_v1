import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const api = read("../src/pages/Projects/components/tickets-api.ts");
const list = read("../src/pages/Projects/components/TicketAttachmentList.tsx");
const conversation = read("../src/pages/Projects/components/TicketConversationPanel.tsx");
const route = read("../functions/api/organizations/[id]/tickets/[ticketId]/attachments.js");
const sessionRoute = read("../functions/api/organizations/[id]/tickets/[ticketId]/attachments/uploads/[uploadId].js");
const service = read("../functions/_lib/ticket-attachment-uploads.js");
const migration = read("../migrations/0029_ticket_attachment_upload_sessions.sql");

test("CC-06 client computes Dropbox hash in 4 MiB blocks only when capability is configured and never persists provider/session secrets in browser storage", () => {
  assert.match(api, /getTicketAttachmentUploadCapability/);
  assert.match(api, /if \(capability\.configured\)/);
  assert.match(api, /DROPBOX_HASH_BLOCK_BYTES\s*=\s*4\s*\*\s*1024\s*\*\s*1024/);
  assert.match(api, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(api, /expectedContentHash/);
  assert.doesNotMatch(api + list + conversation, /localStorage|sessionStorage/);
  assert.doesNotMatch(api + list + conversation, /provider_session_id|providerSessionId/);
});

test("CC-06 resumable client has HEAD, If-Match, reload resume and explicit cancel wiring", () => {
  assert.match(api, /method:\s*"HEAD"/);
  assert.match(api, /Upload-Offset/);
  assert.match(api, /If-Match/);
  assert.match(api, /listTicketAttachmentUploadSessions/);
  assert.match(api, /resumeTicketAttachmentUpload/);
  assert.match(api, /cancelTicketAttachmentUpload/);
  assert.match(list, /Retomar/);
  assert.match(list, /Cancelar envio/);
  assert.match(list, /Pausar/);
  assert.match(conversation, /Retomar/);
});

test("CC-06 new path does not auto-delete resumable sessions on transient errors", () => {
  const resumableIndex = api.indexOf("if (started.upload.resumable");
  const legacyIndex = api.indexOf("// Legacy path remains available", resumableIndex);
  const deleteIndex = api.indexOf('method: "DELETE"', resumableIndex);
  assert.ok(resumableIndex >= 0 && legacyIndex > resumableIndex);
  assert.ok(deleteIndex > legacyIndex, "DELETE fallback must be confined to the legacy path");
});

test("CC-06 server is fail-closed and protects provider session IDs", () => {
  assert.match(route, /getTicketResumableUploadCapability/);
  assert.match(route, /TICKET_RESUMABLE_UPLOADS_SCHEMA_OUTDATED/);
  assert.match(sessionRoute, /Cache-Control/);
  assert.match(sessionRoute, /private, no-store/);
  assert.match(service, /provider_session_id/);
  assert.doesNotMatch(service.match(/function publicSession[\s\S]*?\n\}/)?.[0] || "", /provider_session_id/);
});

test("CC-06 migration encodes authoritative capacity and terminal retention", () => {
  assert.match(migration, /CREATE TRIGGER cc06_upload_capacity/);
  assert.match(migration, /> 157286400/);
  assert.match(migration, /\) >= 5/);
  assert.match(migration, /83886080/);
  assert.match(migration, /CREATE TRIGGER cc06_upload_no_delete/);
  assert.match(migration, /TICKET_ATTACHMENT_UPLOAD_RETENTION_REQUIRED/);
});

test("CC-06 ordinary-session mutations revalidate create/manage and cancellation is CAS-guarded", () => {
  assert.match(sessionRoute, /ticket\.create/);
  assert.match(sessionRoute, /ticket\.manage/);
  assert.match(sessionRoute, /requireStandardUploadMutationPermission/);
  assert.match(service, /s\.state='CANCELLED' AND s\.version=\?/);
});
