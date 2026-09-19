import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { SessionProvider, useSession } from "../../../src/auth/session";
import { LoadingProvider } from "../../../src/components/loading";
import DocumentsSection from "../../../src/pages/Projects/components/DocumentsSection";
import AdminFiles from "../../../src/pages/AdminFiles";
import { MapPanelProvider, MapPanelAccessGate } from "../../../src/pages/Kepler/map-panel/MapPanelProvider";

// Only the surrounding page is a fixture. Requests, error conversion, loading,
// file transfer, permissions and rendered error surfaces are production code.
function DocumentsFixture() {
  const [organizationId, setOrganizationId] = useState(1);
  return (
    <main>
      <button onClick={() => setOrganizationId(2)}>Trocar organização</button>
      <DocumentsSection user={{ id: 1, role: "super_admin" }} organizationId={organizationId} />
    </main>
  );
}

function MapFixture() {
  const { loading } = useSession();
  if (loading) return null;
  return (
    <MapPanelProvider>
      <MapPanelAccessGate><p>Área do mapa disponível</p></MapPanelAccessGate>
    </MapPanelProvider>
  );
}

const view = new URLSearchParams(window.location.search).get("view");
createRoot(document.getElementById("fixture-root")!).render(
  <MemoryRouter initialEntries={["/maps/new/create"]}>
    <LoadingProvider>
      {view === "map" ? <SessionProvider><MapFixture /></SessionProvider> : view === "admin" ? <SessionProvider><AdminFiles /></SessionProvider> : <DocumentsFixture />}
    </LoadingProvider>
  </MemoryRouter>,
);
