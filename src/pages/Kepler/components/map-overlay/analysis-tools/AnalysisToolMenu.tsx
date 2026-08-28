import {
  useEffect,
  useRef,
  type KeyboardEvent,
} from "react";

import type {
  BufferInsertionMode,
  MapAnalysisTool,
  SelectingToolMapToolState,
} from "./map-tool-state";
import "./analysis-tool-menu.css";

type AnalysisToolMenuProps = {
  state: SelectingToolMapToolState;
  canBuffer: boolean;
  canIsochrone: boolean;
  canPlaceMarker: boolean;
  onSelectTool: (tool: MapAnalysisTool) => void;
  onSelectBufferMode: (mode: BufferInsertionMode) => void;
  onStartPlacement: () => void;
  onStartMarkerPlacement: () => void;
  onCancel: () => void;
};

function ToolGlyph({ kind }: { kind: "buffer" | "isochrone" | "marker" }) {
  if (kind === "buffer") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="1.6" />
        <path d="M12 12l5.5-5.5" />
      </svg>
    );
  }

  if (kind === "isochrone") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.5" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export default function AnalysisToolMenu({
  state,
  canBuffer,
  canIsochrone,
  canPlaceMarker,
  onSelectTool,
  onSelectBufferMode,
  onStartPlacement,
  onStartMarkerPlacement,
  onCancel,
}: AnalysisToolMenuProps) {
  const menuRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const frame = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>(
          "button:not(:disabled), input:not(:disabled)",
        )
        ?.focus();
    });

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      ) {
        onCancel();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      previousFocusRef.current?.focus();
    };
  }, [onCancel, state.menu]);

  function handleKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }

    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    const focusable = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled)",
      ) || [],
    );
    if (!focusable.length) return;

    event.preventDefault();
    const currentIndex = focusable.findIndex(
      (item) => item === document.activeElement,
    );
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? focusable.length - 1
          : event.key === "ArrowUp"
            ? currentIndex <= 0
              ? focusable.length - 1
              : currentIndex - 1
            : currentIndex < 0 || currentIndex === focusable.length - 1
              ? 0
              : currentIndex + 1;

    focusable[nextIndex]?.focus();
  }

  const selectedBufferMode =
    state.tool === "buffer" && state.preliminaryOptions?.kind === "buffer"
      ? state.preliminaryOptions.insertionMode
      : null;

  return (
    <section
      ref={menuRef}
      className="maono-analysis-tool-menu"
      role="menu"
      aria-label="Adicionar análise"
      onKeyDown={handleKeyboard}
      data-menu={state.menu}
    >
      {state.menu === "root" ? (
        <>
          <header>
            <span>Ferramentas do mapa</span>
            <strong>Adicionar análise</strong>
          </header>
          <div className="maono-analysis-tool-menu__items">
            {canIsochrone ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => onSelectTool("isochrone")}
              >
                <ToolGlyph kind="isochrone" />
                <span>
                  <strong>Criar isócrona</strong>
                  <small>Escolher origem no mapa</small>
                </span>
                <b aria-hidden="true">›</b>
              </button>
            ) : null}

            {canBuffer ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => onSelectTool("buffer")}
              >
                <ToolGlyph kind="buffer" />
                <span>
                  <strong>Criar buffer</strong>
                  <small>Único ou múltiplas origens</small>
                </span>
                <b aria-hidden="true">›</b>
              </button>
            ) : null}

            {canPlaceMarker ? (
              <button
                type="button"
                role="menuitem"
                onClick={onStartMarkerPlacement}
              >
                <ToolGlyph kind="marker" />
                <span>
                  <strong>Adicionar marcador</strong>
                  <small>Posicionar um ponto no mapa</small>
                </span>
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {state.menu === "buffer" ? (
        <>
          <header>
            <span>Adicionar análise</span>
            <strong>Criar buffer</strong>
          </header>
          <div className="maono-analysis-tool-menu__body">
            <fieldset>
              <legend>Modo</legend>
              <label>
                <input
                  type="radio"
                  name="maono-buffer-insertion-mode"
                  checked={selectedBufferMode === "single"}
                  onChange={() => onSelectBufferMode("single")}
                />
                <span>
                  <strong>Buffer único</strong>
                  <small>Uma origem por operação</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="maono-buffer-insertion-mode"
                  checked={selectedBufferMode === "multi"}
                  onChange={() => onSelectBufferMode("multi")}
                />
                <span>
                  <strong>Multibuffers</strong>
                  <small>Várias origens na mesma sessão</small>
                </span>
              </label>
            </fieldset>
          </div>
          <footer>
            <button type="button" onClick={onCancel}>
              Cancelar
            </button>
            <button
              type="button"
              className="is-primary"
              disabled={!selectedBufferMode}
              onClick={onStartPlacement}
            >
              Posicionar
            </button>
          </footer>
        </>
      ) : null}

      {state.menu === "isochrone" ? (
        <>
          <header>
            <span>Adicionar análise</span>
            <strong>Criar isócrona</strong>
          </header>
          <div
            className="maono-analysis-tool-menu__body"
            data-analysis-submenu="isochrone"
          >
            <p>
              Primeiro escolha a origem no mapa. A configuração da análise
              será apresentada na etapa seguinte.
            </p>
          </div>
          <footer>
            <button type="button" onClick={onCancel}>
              Cancelar
            </button>
            <button
              type="button"
              className="is-primary"
              onClick={onStartPlacement}
            >
              Posicionar
            </button>
          </footer>
        </>
      ) : null}
    </section>
  );
}
