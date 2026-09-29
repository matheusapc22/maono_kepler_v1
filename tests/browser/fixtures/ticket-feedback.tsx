import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import TicketFeedbackPanel from "../../../src/pages/Projects/components/TicketFeedbackPanel";
function Fixture() {
  const [org, setOrg] = useState(1),
    [open, setOpen] = useState(0);
  return (
    <main>
      <button onClick={() => setOrg(org === 1 ? 2 : 1)}>
        Trocar organização
      </button>
      <p>Chamado aberto: {open}</p>
      <TicketFeedbackPanel
        key={org}
        organizationId={org}
        canManage={!location.search.includes("viewer")}
        onOpen={setOpen}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
);
