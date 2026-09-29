import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import TicketCasesPanel from "../../../src/pages/Projects/components/TicketCasesPanel";
function Fixture() {
  const [org, setOrg] = useState(1);
  return (
    <main>
      <button onClick={() => setOrg(org === 1 ? 2 : 1)}>
        Trocar organização
      </button>
      <TicketCasesPanel
        organizationId={org}
        canManage={!location.search.includes("viewer")}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
);
