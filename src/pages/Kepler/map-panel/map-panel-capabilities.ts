import type {
  MapCapabilities,
} from "./types";

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
  if (!capabilities?.[capability]) {
    return {
      ok: false,
      code: "CAPABILITY_DENIED",
      reason: `A capacidade ${capability} não foi concedida.`,
      capability,
      command,
    };
  }

  return { ok: true };
}
