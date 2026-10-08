import { useEffect, useState } from "react";

import { useMapPanel } from "../../map-panel/MapPanelContext";
import "./panel-save-action.css";

const SECONDARY_ACTIONS = [
  "support",
  "open-created",
] as const;
type SaveActionId = "primary" | (typeof SECONDARY_ACTIONS)[number];
type SaveActionState = {
  id: SaveActionId;
  label: string;
  disabled: boolean;
  busy: boolean;
};
type SaveBridgeState = {
  primary: SaveActionState | null;
  secondary: SaveActionState[];
  message: string;
  messageTone: "error" | "warning" | "success";
  saveState: string;
  previewState: string;
};

const INITIAL_STATE: SaveBridgeState = {
  primary: null,
  secondary: [],
  message: "",
  messageTone: "success",
  saveState: "idle",
  previewState: "",
};
const CONTROLLER_SELECTOR = '[data-maono-save-controller="true"]';

function saveController() {
  return document.querySelector<HTMLElement>(CONTROLLER_SELECTOR);
}

function saveAction(id: SaveActionId, controller = saveController()) {
  return controller?.querySelector<HTMLButtonElement>(
    `button[data-maono-save-action="${id}"]`,
  ) ?? null;
}

function readAction(id: SaveActionId, controller: HTMLElement | null): SaveActionState | null {
  const button = saveAction(id, controller);
  if (!button) return null;
  const label = button.querySelector('[data-maono-save-label="true"]') ?? button;
  return {
    id,
    label: label.textContent?.trim() ?? "",
    disabled: button.disabled || button.getAttribute("aria-disabled") === "true",
    busy: button.getAttribute("aria-busy") === "true",
  };
}

function readBridgeState(controller: HTMLElement | null): SaveBridgeState {
  const message = controller?.querySelector<HTMLElement>("[data-maono-save-message]");
  const tone = message?.getAttribute("data-maono-save-message");
  return {
    primary: readAction("primary", controller),
    secondary: SECONDARY_ACTIONS.flatMap((id) => {
      const action = readAction(id, controller);
      return action ? [action] : [];
    }),
    message: message?.textContent?.trim() ?? "",
    messageTone: tone === "error" || tone === "warning" ? tone : "success",
    saveState: controller?.dataset.maonoSaveState ?? "idle",
    previewState: controller?.dataset.maonoPreviewState ?? "",
  };
}

function sameAction(left: SaveActionState | null, right: SaveActionState | null) {
  return left === right || Boolean(left && right &&
    left.id === right.id && left.label === right.label &&
    left.disabled === right.disabled && left.busy === right.busy);
}

function sameState(left: SaveBridgeState, right: SaveBridgeState) {
  return (
    sameAction(left.primary, right.primary) &&
    left.secondary.length === right.secondary.length &&
    left.secondary.every((action, index) => sameAction(action, right.secondary[index])) &&
    left.message === right.message &&
    left.messageTone === right.messageTone &&
    left.saveState === right.saveState && left.previewState === right.previewState
  );
}

function invokeAction(id: SaveActionId) {
  const button = saveAction(id);
  if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
    button.click();
  }
}

export default function PanelSaveAction() {
  const { context } = useMapPanel();
  const [state, setState] = useState<SaveBridgeState>(INITIAL_STATE);
  const allowed = context?.capabilities?.saveMap === true;

  useEffect(() => {
    if (!allowed || typeof document === "undefined") {
      setState(INITIAL_STATE);
      return undefined;
    }

    let animationFrame = 0;
    let observedController: HTMLElement | null = null;
    const synchronize = () => {
      animationFrame = 0;
      const controller = saveController();
      if (controller !== observedController) {
        controllerObserver.disconnect();
        observedController = controller;
        if (controller) {
          controllerObserver.observe(controller, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
            attributeFilter: [
              "disabled", "aria-disabled", "aria-busy", "data-maono-save-action",
              "data-maono-save-label", "data-maono-save-message", "data-maono-save-state", "data-maono-preview-state",
            ],
          });
        }
      }
      const next = readBridgeState(controller);
      setState((current) => (sameState(current, next) ? current : next));
    };
    const scheduleSynchronize = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(synchronize);
    };
    const controllerObserver = new MutationObserver(scheduleSynchronize);
    // Only controller mount/removal is watched outside the controller. Changes
    // rendered by the panel itself must not feed back into synchronization.
    const discoveryObserver = new MutationObserver((records) => {
      if (observedController && !observedController.isConnected) {
        scheduleSynchronize();
        return;
      }
      if (records.some((record) => Array.from(record.addedNodes).some((node) =>
        node instanceof Element && (node.matches(CONTROLLER_SELECTOR) || node.querySelector(CONTROLLER_SELECTOR)),
      ))) scheduleSynchronize();
    });
    discoveryObserver.observe(document.body, { subtree: true, childList: true });
    synchronize();

    return () => {
      controllerObserver.disconnect();
      discoveryObserver.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [allowed]);

  if (!allowed) return null;
  const primaryLabel = state.primary?.label;

  return (
    <footer className="maono-layer-panel__save-footer" data-panel-save-action="true" data-save-state={state.saveState} data-preview-state={state.previewState}>
      {state.message || state.secondary.length ? (
        <div className="maono-layer-panel__save-details" role="region" aria-label="Detalhes do salvamento" tabIndex={0}>
          {state.message ? (
            <div
              className={`maono-layer-panel__save-message is-${state.messageTone}`}
              role={state.messageTone === "error" ? "alert" : "status"}
              aria-live="polite"
              tabIndex={0}
            >
              {state.message}
            </div>
          ) : null}
          {state.secondary.length ? (
            <div className="maono-layer-panel__save-secondary" role="group" aria-label="Ações do salvamento">
              {state.secondary.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  data-panel-save-proxy={action.id}
                  className="maono-layer-panel__save-secondary-button"
                  onClick={() => invokeAction(action.id)}
                  disabled={action.disabled}
                  aria-busy={action.busy}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {state.primary && <button
        type="button"
        data-panel-save-proxy="primary"
        className="maono-layer-panel__save-button"
        onClick={() => invokeAction("primary")}
        disabled={!state.primary || state.primary.disabled}
        aria-busy={state.primary?.busy ?? false}
      >
        {primaryLabel || "Salvar mapa"}
      </button>}
    </footer>
  );
}
