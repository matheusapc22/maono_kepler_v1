import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function OverrideUploadMessage() {
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    // If it isn’t there on first render, watch for it
    const existing = document.querySelector(".file-upload__message");
    if (existing) {
      setTarget(existing);
      return;
    }
    const obs = new MutationObserver(() => {
      const el = document.querySelector(".file-upload__message");
      if (el) {
        setTarget(el);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  if (!target) return null;
  return createPortal(
    <div className="replacement">
      Envie <strong>CSV</strong>, <strong>Json</strong>,{" "}
      <strong>GeoJSON</strong>, <strong>Arrow</strong>, <strong>Parquet</strong>{" "}
      ou mapas salvos <strong>Json</strong>.
    </div>,
    target
  );
}
