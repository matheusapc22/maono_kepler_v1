import type {
  KeplerCommandResult,
  KeplerEngineCommands,
  MapAnalysisKind,
} from "../engine-adapter/types.ts";
import {
  VIEWER_MUTATION_POLICY,
  type ViewerMutationPolicy,
  type ViewerMutationPolicyKind,
} from "./viewer-persistent-mutations.ts";

export const MAONO_VIEWER_MUTATION_EVENT = "maono:viewer-mutation-policy";

export type ViewerMutationEventDetail = {
  command: keyof KeplerEngineCommands;
  kind: ViewerMutationPolicyKind;
  operation: ViewerMutationPolicy["operation"] | null;
  changed: boolean;
};

function emitViewerMutation(detail: ViewerMutationEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ViewerMutationEventDetail>(MAONO_VIEWER_MUTATION_EVENT, {
      detail,
    }),
  );
}

export function viewerMutationEventDetail(event: Event) {
  if (!(event instanceof CustomEvent)) return null;
  const detail = event.detail as ViewerMutationEventDetail | null;
  if (!detail || !detail.command || !detail.kind) return null;
  return detail;
}

function blocked(command: keyof KeplerEngineCommands): KeplerCommandResult {
  return {
    ok: false,
    code: "CAPABILITY_DENIED",
    reason:
      "Esta alteração não pode ser aplicada diretamente no workspace Viewer. Use uma operação persistível da solicitação de alteração.",
    command: String(command),
  };
}

function dynamicPolicy(
  command: keyof KeplerEngineCommands,
  args: unknown[],
): ViewerMutationPolicy {
  if (command === "addGeoJsonLayer") {
    const input = args[0] as { transient?: boolean; analysisKind?: MapAnalysisKind } | null;
    if (input?.transient && (input.analysisKind === "buffer" || input.analysisKind === "isochrone")) {
      return { kind: "session", operation: "dynamic" };
    }
    return { kind: "blocked", operation: "dynamic" };
  }
  if (
    command === "removeTransientLayer" ||
    command === "markLayerPersistent" ||
    command === "markLayerTransient"
  ) {
    return { kind: "session", operation: "dynamic" };
  }
  return VIEWER_MUTATION_POLICY[command];
}

export function withViewerMutationPolicy(
  commands: KeplerEngineCommands,
  enabled: boolean,
): KeplerEngineCommands {
  if (!enabled) return commands;

  return new Proxy(commands, {
    get(target, property, receiver) {
      const original = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || typeof original !== "function") {
        return original;
      }
      if (!(property in VIEWER_MUTATION_POLICY)) return original;
      const command = property as keyof KeplerEngineCommands;

      return (...args: unknown[]) => {
        const policy = dynamicPolicy(command, args);
        if (policy.kind === "blocked") {
          emitViewerMutation({
            command,
            kind: "blocked",
            operation: policy.operation || null,
            changed: false,
          });
          return blocked(command);
        }

        const result = original.apply(target, args) as KeplerCommandResult;
        const changed = Boolean(result?.ok && result.changed);
        emitViewerMutation({
          command,
          kind: policy.kind,
          operation: policy.operation || null,
          changed,
        });
        return result;
      };
    },
  }) as KeplerEngineCommands;
}
