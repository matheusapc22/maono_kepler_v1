import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import "../../../src/components/loading/UniversalLoader.css";
import { UniversalLoader } from "../../../src/components/loading/UniversalLoader";
import {
  isSaveRequestAbort,
  runWithSaveStallNotice,
} from "../../../src/pages/Kepler/save-operation-resilience";

type SaveState = "idle" | "saving" | "stalled" | "cancelled";

function hangingOperation(signal: AbortSignal) {
  return new Promise<void>((_resolve, reject) => {
    function handleAbort() {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function Fixture() {
  const [state, setState] = useState<SaveState>("idle");
  const [unrelatedCount, setUnrelatedCount] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  async function startSave() {
    const controller = new AbortController();
    controllerRef.current = controller;
    setState("saving");

    try {
      await runWithSaveStallNotice({
        stallAfterMs: 50,
        onStall: () => setState("stalled"),
        operation: () => hangingOperation(controller.signal),
      });
    } catch (error) {
      if (isSaveRequestAbort(error)) {
        setState("cancelled");
        return;
      }
      throw error;
    } finally {
      controllerRef.current = null;
    }
  }

  return (
    <main style={{ padding: 32 }}>
      <button
        id="unrelated-control"
        type="button"
        onClick={() => setUnrelatedCount((value) => value + 1)}
      >
        Controle não relacionado
      </button>
      <span id="unrelated-count">{unrelatedCount}</span>

      <div style={{ marginTop: 24 }}>
        <button
          type="button"
          onClick={() => void startSave()}
          disabled={state === "saving" || state === "stalled"}
        >
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            {state === "saving" || state === "stalled" ? (
              <UniversalLoader size="inline" accessibleLabel="Salvando projeto" />
            ) : null}
            <span>Salvar localmente</span>
          </span>
        </button>

        {state === "stalled" ? (
          <button
            type="button"
            onClick={() => controllerRef.current?.abort()}
          >
            Cancelar espera
          </button>
        ) : null}
      </div>

      <output id="save-state">{state}</output>
    </main>
  );
}

const root = document.getElementById("fixture-root");

if (!root) {
  throw new Error("Fixture root ausente.");
}

createRoot(root).render(<Fixture />);
