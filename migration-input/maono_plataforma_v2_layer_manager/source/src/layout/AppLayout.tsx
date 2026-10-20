import { useState } from "react";
import { useDispatch } from "react-redux";
import { wrapTo, toggleModal } from "@kepler.gl/actions";
import { Sidebar } from "../components/Sidebar";
import { Topbar } from "../components/Topbar";
import { FilterPanel } from "../components/FilterPanel";
import { DataPanel } from "../components/DataPanel";
import { AnalyticsPanel } from "../components/AnalyticsPanel";
import { UserManagementPanel } from "../components/UserManagementPanel";
import OrganizationManagementPanel from "../components/OrganizationManagementPanel";
import FileManagementPanel from "../components/FileManagementPanel";
import { KeplerPanelErrorBoundary } from "../components/KeplerPanelErrorBoundary";
import { MaonoDataImporter } from "../components/MaonoDataImporter";
import { MapOverlayControls } from "../components/MapOverlayControls";

const KEPLER_ID = "map";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [activePanel, setActivePanel] = useState("layers");
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [isColumnsOpen, setIsColumnsOpen] = useState(false);
  const dispatch = useDispatch();

  const handleOpenData = () => handlePanelSelect("dados");
  const handlePanelSelect = (panel: string) => {
    dispatch(wrapTo(KEPLER_ID, toggleModal(null)));
    setIsAIPanelOpen(false);
    setIsColumnsOpen(false);
    if (["home", "organizations", "files"].includes(panel)) {
      setActivePanel(panel);
      setIsPanelOpen(false);
      return;
    }
    if (activePanel === panel) setIsPanelOpen(!isPanelOpen);
    else {
      setActivePanel(panel);
      setIsPanelOpen(true);
    }
  };

  const isPanelActive = ["layers", "dados", "charts", "users"].includes(activePanel);
  const isWorkspacePanel = ["organizations", "files"].includes(activePanel);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#020305]">
      {isWorkspacePanel && <style>{`
        .map-control,.mapboxgl-control-container,.maono-controls,#kepler-gl__map .map-control-panel {
          opacity:0!important;pointer-events:none!important;visibility:hidden!important;z-index:-1!important;display:none!important;
        }
      `}</style>}

      <Sidebar activePanel={activePanel} onPanelSelect={handlePanelSelect} onOpenDataModal={handleOpenData} />
      <div className="relative flex h-full min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="relative flex flex-1 overflow-hidden bg-[#020305]">
          <div
            className="absolute left-0 top-0 z-[9999] flex h-full transition-all duration-500 ease-out"
            style={{
              transform: isPanelOpen && isPanelActive ? "translateX(0)" : "translateX(-100%)",
              width: ["charts", "users"].includes(activePanel) ? "50%" : "380px",
            }}
          >
            <div className="h-full w-full overflow-hidden border-r border-[#161f30] bg-[#04060a]/95 shadow-[20px_0_40px_rgba(0,0,0,0.8)] backdrop-blur-xl">
              <KeplerPanelErrorBoundary>
                {activePanel === "layers" && <FilterPanel />}
                {activePanel === "dados" && <DataPanel onOpenImporter={() => setIsImporterOpen(true)} />}
                {activePanel === "users" && <UserManagementPanel />}
                {activePanel === "charts" && (
                  <AnalyticsPanel
                    isAIPanelOpen={isAIPanelOpen}
                    setIsAIPanelOpen={setIsAIPanelOpen}
                    isColumnsOpen={isColumnsOpen}
                    setIsColumnsOpen={setIsColumnsOpen}
                  />
                )}
              </KeplerPanelErrorBoundary>
            </div>
            {isPanelActive && (
              <button
                type="button"
                onClick={() => {
                  setIsPanelOpen(!isPanelOpen);
                  if (isPanelOpen) {
                    setIsAIPanelOpen(false);
                    setIsColumnsOpen(false);
                  }
                }}
                className="group absolute top-29 z-50 flex h-[50px] w-[19px] cursor-pointer items-center justify-center outline-none transition-all duration-500 ease-in-out"
                style={{
                  right: activePanel === "charts" ? (isAIPanelOpen ? "-428px" : isColumnsOpen ? "-328px" : "-21px") : "-21px",
                  backgroundColor: "#0a0f18", borderTop: "2px solid #C5A059", borderRight: "2px solid #C5A059",
                  borderBottom: "2px solid #C5A059", borderLeft: "none", borderRadius: "0 12px 12px 0", color: "#C5A059",
                  boxShadow: "4px 0 10px rgba(197,160,89,0.25), inset 2px 0 5px rgba(197,160,89,0.3)",
                }}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={isPanelOpen ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"} />
                </svg>
              </button>
            )}
          </div>

          {activePanel === "organizations" && (
            <div className="fixed bottom-0 left-20 right-0 top-0 z-[999999999] overflow-y-auto bg-[#020305] shadow-2xl">
              <OrganizationManagementPanel />
            </div>
          )}
          {activePanel === "files" && (
            <div className="fixed bottom-0 left-20 right-0 top-0 z-[999999999] overflow-y-auto bg-[#020305] shadow-2xl">
              <FileManagementPanel />
            </div>
          )}
          <div className={`relative z-0 h-full w-full flex-1 transition-opacity duration-300 ${isWorkspacePanel ? "pointer-events-none invisible opacity-0" : "visible opacity-100"}`}>
            {children}
            <MapOverlayControls />
          </div>
        </main>
      </div>
      <MaonoDataImporter isOpen={isImporterOpen} onClose={() => setIsImporterOpen(false)} />
    </div>
  );
}
