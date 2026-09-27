import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("CC-05 routes, detail drawer and permission catalogs are wired to the functional conversation service", () => {
  const drawer = source("../src/pages/Projects/components/TicketDetailDrawer.tsx");
  const panel = source("../src/pages/Projects/components/TicketConversationPanel.tsx");
  const detail = source("../functions/api/organizations/[id]/tickets/[ticketId].js");
  const permissions = source("../functions/_lib/permissions.js");
  const frontendPermissions = source("../src/access-control/permissions.ts");
  const messages = source("../functions/api/organizations/[id]/tickets/[ticketId]/messages.js");
  const drafts = source("../functions/api/organizations/[id]/tickets/[ticketId]/drafts.js");

  assert.match(drawer, /TicketConversationPanel/);
  assert.match(drawer, /bundle=\{detail\.conversation\}/);
  assert.match(detail, /readTicketConversationBundle/);
  assert.match(messages, /createTicketMessage/);
  assert.match(drafts, /createTicketDraft/);
  assert.match(permissions, /ticket\.note\.view/);
  assert.match(permissions, /ticket\.note\.create/);
  assert.match(frontendPermissions, /ticket\.note\.view/);
  assert.match(frontendPermissions, /ticket\.note\.create/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage/);
  assert.match(panel, /updateTicketConversationDraft/);
  assert.match(panel, /Idempotency|sendTicketConversationMessage|crypto\.randomUUID/);
  assert.match(panel, /Nota interna/);
});

test("CC-05 existing readers preserve confidentiality independently of the feature flag", () => {
  const center = source("../functions/_lib/ticket-center.js");
  const download = source("../functions/api/organizations/[id]/tickets/[ticketId]/attachments/[attachmentId]/download.js");
  const list = source("../functions/api/organizations/[id]/tickets.js");
  assert.match(center, /canViewInternal/);
  assert.match(center, /audience = 'ticket'/);
  assert.match(center, /attachments_count/);
  assert.match(download, /assertConversationAttachmentRead/);
  assert.match(list, /ticket\.note\.view/);
});
