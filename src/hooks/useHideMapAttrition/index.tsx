import { useEffect } from "react";

export function useHideMapAttribution(scopeSelector = ".kepler-gl__map") {
  useEffect(() => {
    const scope = document.querySelector(scopeSelector) || document.body;

    const nuke = () => {
      scope
        .querySelectorAll(".maplibre-attribution-container")
        .forEach((el) => el.remove());
    };

    // Initial pass
    nuke();

    // Watch for re-insertions (e.g., on basemap switch)
    const mo = new MutationObserver(() => nuke());
    mo.observe(scope, { childList: true, subtree: true });

    return () => mo.disconnect();
  }, [scopeSelector]);
}
