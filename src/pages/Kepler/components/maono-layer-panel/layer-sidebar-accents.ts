/** Sidebar identity only. Never derive these colors from cartographic styles. */
export const LAYER_SIDEBAR_ACCENT_FAMILIES = [
  [
    "var(--maono-accent-bright, #f2c766)",
    "var(--maono-accent-text, #f3d58a)",
    "var(--maono-accent-strong, #d6a84f)",
    "var(--maono-accent, #c5a059)",
    "var(--maono-accent-muted, #8a6a2f)",
  ],
  ["#cbd0d6", "#b1b6be", "#979da6", "#7d848e", "#666e78"],
  ["#ffffff", "#f5f5f5", "#ececec", "#e1e1e1", "#d6d6d6"],
] as const;

export type LayerSidebarAccents = ReadonlyMap<string, string>;

export type LayerSidebarAccentRegistry = {
  readonly nextSequence: number;
  readonly sequences: ReadonlyMap<string, number>;
};

export function getLayerSidebarAccent(sequence: number): string {
  const familyCount = LAYER_SIDEBAR_ACCENT_FAMILIES.length;
  const family = LAYER_SIDEBAR_ACCENT_FAMILIES[sequence % familyCount];
  const shade = Math.floor(sequence / familyCount) % family.length;
  return family[shade];
}

function stableLayerIdHash(layerId: string): number {
  let hash = 0;
  for (let index = 0; index < layerId.length; index += 1) {
    hash = (hash * 31 + layerId.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/** Legacy/standalone fallback: names, visibility and list position never matter. */
export function deriveLayerSidebarAccent(layerId: string): string {
  return getLayerSidebarAccent(stableLayerIdHash(layerId));
}

export function resolveLayerSidebarAccent(
  layerId: string,
  sidebarAccents?: LayerSidebarAccents,
): string {
  return sidebarAccents?.get(layerId) ?? deriveLayerSidebarAccent(layerId);
}

export function createLayerSidebarAccentRegistry(): LayerSidebarAccentRegistry {
  return { nextSequence: 0, sequences: new Map() };
}

/** Pure reconciliation. Retain removed IDs so undo/remount cannot recolor them.
 * New identities alternate families; more than 15 identities cycle the palette.
 * Storage-disabled browsers use the same ID fallback on every fresh load. */
export function registerLayerSidebarAccents(
  registry: LayerSidebarAccentRegistry,
  layerIds: readonly string[],
  assignment: "sequence" | "id" = "sequence",
): LayerSidebarAccentRegistry {
  let sequences: Map<string, number> | undefined;
  let nextSequence = registry.nextSequence;
  for (const layerId of layerIds) {
    if (!layerId || (sequences ?? registry.sequences).has(layerId)) continue;
    sequences ??= new Map(registry.sequences);
    sequences.set(layerId, assignment === "id" ? stableLayerIdHash(layerId) : nextSequence);
    nextSequence += 1;
  }
  return sequences ? { nextSequence, sequences } : registry;
}

export function toLayerSidebarAccents(
  registry: LayerSidebarAccentRegistry,
): LayerSidebarAccents {
  return new Map(Array.from(registry.sequences, ([id, sequence]) => [
    id,
    getLayerSidebarAccent(sequence),
  ]));
}

export function serializeLayerSidebarAccents(registry: LayerSidebarAccentRegistry): string {
  return JSON.stringify({
    version: 1,
    nextSequence: registry.nextSequence,
    sequences: Array.from(registry.sequences),
  });
}

/** Called only after React commits. A readable but unwritable cache cannot
 * preserve a sequence through reload, so switch every known ID to the same
 * deterministic fallback, including IDs retained for undo/re-add. */
export function persistLayerSidebarAccents(
  registry: LayerSidebarAccentRegistry,
  write: (serialized: string) => void,
): { registry: LayerSidebarAccentRegistry; canPersist: boolean } {
  try {
    write(serializeLayerSidebarAccents(registry));
    return { registry, canPersist: true };
  } catch {
    return {
      registry: registerLayerSidebarAccents(
        createLayerSidebarAccentRegistry(),
        Array.from(registry.sequences.keys()),
        "id",
      ),
      canPersist: false,
    };
  }
}

/** Store only IDs and palette positions, never user-provided CSS or map data. */
export function parseLayerSidebarAccents(raw: string | null): LayerSidebarAccentRegistry | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const data = value as Record<string, unknown>;
    if (
      data.version !== 1 ||
      !Number.isSafeInteger(data.nextSequence) ||
      (data.nextSequence as number) < 0 ||
      !Array.isArray(data.sequences) ||
      data.sequences.length > 100_000
    ) return null;

    const sequences = new Map<string, number>();
    for (const entry of data.sequences) {
      if (
        !Array.isArray(entry) || entry.length !== 2 ||
        typeof entry[0] !== "string" || !entry[0] ||
        !Number.isSafeInteger(entry[1]) || entry[1] < 0 ||
        sequences.has(entry[0])
      ) return null;
      sequences.set(entry[0], entry[1]);
    }
    if ((data.nextSequence as number) < sequences.size) return null;
    return { nextSequence: data.nextSequence as number, sequences };
  } catch {
    return null;
  }
}
