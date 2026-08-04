import { useEffect, useState } from "react";

import { useMapPanel } from "../../map-panel/MapPanelContext";
import "./panel-save-action.css";

type SaveBridgeState = {
  available: boolean;
  disabled: boolean;
  busy: boolean;
  message: string;
  messageTone: "error" | "success";
};

const INITIAL_STATE: SaveBridgeState = {
  available: false,
  disabled: true,
  busy: false,
  message: "",
  messageTone: "success",
};

const LEGACY_CONTAINER_SELECTOR =
  '[data-maono-no-preview="true"].fixed.bottom-6.right-6';

function legacyContainer() {
  return document.querySelector<HTMLElement>(LEGACY_CONTAINER_SELECTOR);
}

function legacySaveButton() {
  return legacyContainer()?.querySelector<HTMLButtonElement>(":scope > button") ?? null;
}

function readBridgeState(): SaveBridgeState {
  const container = legacyContainer();
  const button = legacySaveButton();
  const messageNode = container?.querySelector<HTMLElement>(
    ':scope > [role="alert"], :scope > [role="status"]',
  );
  const buttonText = button?.textContent?.trim() ?? "";

  return {
    available: Boolean(button),
    disabled: !button || button.disabled,
    busy: /salvando|criando/i.test(buttonText),
    message: messageNode?.textContent?.trim() ?? "",
    messageTone:
      messageNode?.getAttribute("role") === "alert" ? "error" : "success",
  };
}

function sameState(left: SaveBridgeState, right: SaveBridgeState) {
  return (
    left.available === right.available &&
    left.disabled === right.disabled &&
    left.busy === right.busy &&
    left.message === right.message &&
    left.messageTone === right.messageTone
  );
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
    const synchronize = () => {
      animationFrame = 0;
      const next = readBridgeState();
      setState((current) => (sameState(current, next) ? current : next));
    };
    const scheduleSynchronize = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(synchronize);
    };
    const observer = new MutationObserver(scheduleSynchronize);

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeFilter: ["disabled", "class"],
    });
    synchronize();

    return () => {
      observer.disconnect();
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [allowed]);

  if (!allowed) {
    return null;
  }

  return (
    <footer
      className="maono-layer-panel__save-footer"
      data-panel-save-action="true"
    >
      {state.message ? (
        <div
          className={`maono-layer-panel__save-message is-${state.messageTone}`}
          role={state.messageTone === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {state.message}
        </div>
      ) : null}

      <button
        type="button"
        className="maono-layer-panel__save-button"
        onClick={() => legacySaveButton()?.click()}
        disabled={!state.available || state.disabled}
        title="Salvar configurações, filtros, estilos e enquadramento do mapa"
      >
        {state.busy ? "Salvando mapa…" : "Salvar mapa"}
      </button>
    </footer>
  );
}
