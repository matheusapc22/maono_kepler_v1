import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useMapPanel } from "../map-panel/MapPanelContext";
import { MAONO_CREATE_POINT_FROM_MARKER_EVENT } from "../components/map-overlay/MarkerContextMenu";

export default function PointFromPinAction() {
  const { context, customMapOverlayEnabled } = useMapPanel();
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!hint) return undefined;
    const timeout = window.setTimeout(() => setHint(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [hint]);

  if (
    typeof document === "undefined" ||
    !customMapOverlayEnabled ||
    context?.capabilities.createPoint !== true
  ) {
    return null;
  }

  function createPoint() {
    if (!document.querySelector(".maono-map-marker")) {
      setHint("Posicione o Pin no mapa antes de criar o ponto.");
      return;
    }
    window.dispatchEvent(new CustomEvent(MAONO_CREATE_POINT_FROM_MARKER_EVENT));
  }

  return createPortal(
    <>
      <button
        type="button"
        onClick={createPoint}
        aria-label="Criar ponto a partir do Pin"
        title="Criar ponto a partir da posição atual do Pin"
        data-maono-no-preview="true"
        style={{
          position: "fixed",
          right: 76,
          bottom: 18,
          zIndex: 10018,
          minHeight: 42,
          padding: "0 14px",
          border: "1px solid rgba(197, 160, 89, .55)",
          borderRadius: 10,
          background: "#11151b",
          color: "#f5f2eb",
          boxShadow: "0 8px 24px rgba(0, 0, 0, .28)",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Criar ponto
      </button>
      {hint ? (
        <div
          role="status"
          style={{
            position: "fixed",
            right: 76,
            bottom: 68,
            zIndex: 10019,
            maxWidth: 300,
            padding: "9px 12px",
            borderRadius: 8,
            background: "#11151b",
            color: "#f5f2eb",
            boxShadow: "0 8px 24px rgba(0, 0, 0, .28)",
            fontSize: 12,
          }}
        >
          {hint}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
