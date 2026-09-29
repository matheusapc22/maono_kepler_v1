import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import TicketKnowledgePanel, {
  TicketKnowledgeReuse,
} from "../../../src/pages/Projects/components/TicketKnowledgePanel";
function Fixture() {
  const [org, setOrg] = useState(1),
    [sent, setSent] = useState(0);
  return (
    <main>
      <button onClick={() => setOrg(org === 1 ? 2 : 1)}>
        Trocar organização
      </button>
      <p>Enviadas: {sent}</p>
      {location.search.includes("reuse") ? (
        <TicketKnowledgeReuse
          key={org}
          organizationId={org}
          ticketId={1}
          canUseInternal
          onSent={() => setSent((n) => n + 1)}
        />
      ) : (
        <TicketKnowledgePanel
          key={org}
          organizationId={org}
          canManage={!location.search.includes("viewer")}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
);
