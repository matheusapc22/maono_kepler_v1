import { useCallback, useLayoutEffect, useMemo, useState } from "react";

import {
  createLayerSidebarAccentRegistry,
  parseLayerSidebarAccents,
  persistLayerSidebarAccents,
  registerLayerSidebarAccents,
  toLayerSidebarAccents,
  type LayerSidebarAccentRegistry,
} from "./layer-sidebar-accents";

type ScopedRegistry = {
  scope: string;
  registry: LayerSidebarAccentRegistry;
  canPersist: boolean;
};

// UI session cache survives the panel unmounting, without touching the engine,
// save payload, project metadata or database. Session storage also covers reload.
const sessionRegistries = new Map<string, ScopedRegistry>();
const storageKey = (scope: string) => `maono:layer-sidebar-accents:v1:${scope}`;

function readRegistry(scope: string): ScopedRegistry {
  const cached = sessionRegistries.get(scope);
  if (cached) return cached;
  try {
    if (typeof window !== "undefined") {
      return {
        scope,
        registry: parseLayerSidebarAccents(window.sessionStorage.getItem(storageKey(scope)))
          ?? createLayerSidebarAccentRegistry(),
        canPersist: true,
      };
    }
  } catch {
    // Restricted/private storage must never block opening the map.
  }
  return { scope, registry: createLayerSidebarAccentRegistry(), canPersist: false };
}

/** One registry owner above both tabs. Reads/reconciliation are pure; only the
 * committed layout effect writes the session cache, including in Strict Mode.
 * Another browser session may initialize a new alternating sequence, since UI
 * identity is intentionally excluded from saved map configuration. */
export function useLayerSidebarAccents(scope: string, layers: readonly { id: string }[]) {
  const [stored, setStored] = useState(() => readRegistry(scope));
  const current = useMemo(
    () => stored.scope === scope ? stored : readRegistry(scope),
    [scope, stored],
  );
  const registry = useMemo(
    () => registerLayerSidebarAccents(
      current.registry,
      layers.map((layer) => layer.id),
      current.canPersist ? "sequence" : "id",
    ),
    [current, layers],
  );

  useLayoutEffect(() => {
    const persisted = current.canPersist
      ? persistLayerSidebarAccents(registry, (serialized) => {
          window.sessionStorage.setItem(storageKey(scope), serialized);
        })
      : { registry, canPersist: false };
    // A failed write replaces all assignments before paint, so reloading after
    // a reorder cannot turn a previously visible sequence into different colors.
    const committed = { scope, ...persisted };
    sessionRegistries.set(scope, committed);
    setStored((previous) => previous.scope === scope && previous.registry === committed.registry &&
      previous.canPersist === committed.canPersist ? previous : committed);
  }, [current.canPersist, registry, scope]);

  const registerLayer = useCallback((layerId: string) => {
    setStored((previous) => {
      const base = previous.scope === scope ? previous : readRegistry(scope);
      const next = registerLayerSidebarAccents(
        base.registry,
        [...layers.map((layer) => layer.id), layerId],
        base.canPersist ? "sequence" : "id",
      );
      return next === base.registry ? base : { ...base, registry: next };
    });
  }, [layers, scope]);

  const sidebarAccents = useMemo(() => toLayerSidebarAccents(registry), [registry]);
  return { sidebarAccents, registerLayer };
}
