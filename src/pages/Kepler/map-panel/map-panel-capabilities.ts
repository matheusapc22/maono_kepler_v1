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

export function authorizeMapPanelCommand(
  capabilities: Partial<MapCapabilities> | null | undefined,
  command: string,
  capability: keyof MapCapabilities,
): KeplerCommandResult {
  const normalizedCommand = String(command || "").trim();

  if (
    !normalizedCommand ||
    !Object.prototype.hasOwnProperty.call(EMPTY_MAP_CAPABILITIES, capability)
  ) {
    return {
      ok: false,
      code: "COMMAND_INVALID",
      reason: "O comando ou a capacidade informada é inválido.",
      command: normalizedCommand || "unknown",
    };
  }

  if (capabilities?.[capability] !== true) {
    return {
      ok: false,
      code: "CAPABILITY_DENIED",
      reason: `A capacidade ${capability} não foi concedida.`,
      capability,
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
