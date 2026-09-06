import type { MapCapabilities } from "./types.ts";
import { EMPTY_MAP_CAPABILITIES } from "./types.ts";

export type KeplerCommandResult =
  | { ok: true }
  | {
      ok: false;
      code: "CAPABILITY_DENIED" | "COMMAND_INVALID";
      reason: string;
      capability?: keyof MapCapabilities;
      command: string;
    };

function effectiveCapability(
  command: string,
  capability: keyof MapCapabilities,
): keyof MapCapabilities {
  // Add Data/importação é ortogonal à criação local de camadas/pontos.
  // Mesmo que um chamador legado ainda passe createLayer, o modal de importação
  // só abre quando importData foi explicitamente concedido.
  if (command === "openAddDataModal") return "importData";

  // Dataset é conteúdo persistente, não lifecycle de layer. O Viewer possui
  // removeLayer/createLayer para produzir operações semânticas, mas isso nunca
  // deve autorizar apagar, renomear ou substituir o dataset subjacente.
  if (
    command === "removeDataset" ||
    command === "renameDataset" ||
    command === "replaceDataset"
  ) {
    return "importData";
  }

  // O adapter base também expõe addGeoJsonLayer para criação genérica. Quando
  // ele chega com createLayer, trata-se de importação persistente, não preview
  // de Buffer/Isócrona (que usa previewBuffer/previewIsochrone no adapter de
  // análise). Exigir importData fecha a escalada createLayer -> dataset novo.
  if (command === "addGeoJsonLayer" && capability === "createLayer") {
    return "importData";
  }

  return capability;
}

export function authorizeMapPanelCommand(
  capabilities: Partial<MapCapabilities> | null | undefined,
  command: string,
  capability: keyof MapCapabilities,
): KeplerCommandResult {
  const normalizedCommand = String(command || "").trim();
  const requiredCapability = effectiveCapability(normalizedCommand, capability);

  if (
    !normalizedCommand ||
    !Object.prototype.hasOwnProperty.call(
      EMPTY_MAP_CAPABILITIES,
      requiredCapability,
    )
  ) {
    return {
      ok: false,
      code: "COMMAND_INVALID",
      reason: "O comando ou a capacidade informada é inválido.",
      command: normalizedCommand || "unknown",
    };
  }

  if (capabilities?.[requiredCapability] !== true) {
    return {
      ok: false,
      code: "CAPABILITY_DENIED",
      reason: `A capacidade ${requiredCapability} não foi concedida.`,
      capability: requiredCapability,
      command: normalizedCommand,
    };
  }

  return { ok: true };
}

export function hasMapCapability(
  capabilities: Partial<MapCapabilities> | null | undefined,
  capability: keyof MapCapabilities,
) {
  return (
    Object.prototype.hasOwnProperty.call(EMPTY_MAP_CAPABILITIES, capability) &&
    capabilities?.[capability] === true
  );
}
