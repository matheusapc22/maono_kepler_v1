import { MemoryRouter } from "react-router";
import TicketDetailDrawer from "../../../src/pages/Projects/components/TicketDetailDrawer";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import NewTicketPopover from "../../../src/pages/Projects/components/NewTicketPopover";
import TicketConversationPanel from "../../../src/pages/Projects/components/TicketConversationPanel";
import {
  DEFAULT_TICKET_ATTACHMENT_LIMITS as limits,
  type Ticket,
  type TicketConversationBundle,
} from "../../../src/pages/Projects/components/ticket-types";
import "../../../src/pages/Projects/projects.css";
import "../../../src/pages/Projects/components/ticket-lifecycle.css";
const ticket: Ticket = {
  id: 17,
  organizationId: 1,
  code: "CC-17",
  subject: "Chamado",
  description: "Contexto",
  status: "open",
  priority: "normal",
  category: "support",
  attachmentsCount: 0,
};
function Fixture() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [open, setOpen] = useState(false),
    [tick, setTick] = useState(0),
    [org, setOrg] = useState(1);
  const [bundle, setBundle] = useState<TicketConversationBundle>({
    enabled: true,
    schemaReady: true,
    permissions: { comment: true, noteView: true, noteCreate: true },
    messages: [],
    drafts: [],
    hasMore: false,
  });
  async function reload() {
    setBundle(await fetch("/api/fixture-bundle").then((r) => r.json()));
  }
  React.useEffect(() => {
    void reload();
  }, []);
  return (
    <main>
      <button onClick={() => setOpen(true)}>Abrir criação</button>
      <button onClick={() => setTick(tick + 1)}>Renderizar pai</button>
      <button onClick={() => void reload()}>Atualizar conversa</button>
      <button onClick={() => setOrg(org + 1)}>Trocar organização</button>
      <button onClick={() => setDetailOpen(true)}>Abrir detalhes</button>
      <p>Render: {tick}</p>
      <TicketDetailDrawer
        open={detailOpen}
        organizationId={org}
        detail={{
          ok: true,
          ticket,
          attachments: [],
          events: [],
          assignees: [],
          attachmentLimits: limits,
          conversation: bundle,
        }}
        loading={false}
        error={null}
        saving={false}
        canManage
        canUpload
        attachmentLimits={limits}
        currentUserId={1}
        onClose={() => setDetailOpen(false)}
        onRetry={() => void reload()}
        onReload={() => void reload()}
        onUpdate={async () => {}}
        onCommand={async () => {}}
      />
      <NewTicketPopover
        key={org}
        open={open}
        organizationId={org}
        canManage
        assignees={[]}
        attachmentLimits={limits}
        lifecycleEnabled
        onClose={() => setOpen(false)}
        onCreated={() => setTick(tick + 1)}
      />
      <TicketConversationPanel
        key={`conversation:${org}`}
        organizationId={org}
        ticket={{ ...ticket, organizationId: org }}
        bundle={bundle}
        currentUserId={1}
        attachmentLimits={limits}
        onReload={() => void reload()}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MemoryRouter>
      <Fixture />
    </MemoryRouter>
  </React.StrictMode>,
);
