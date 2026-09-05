import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { MaonoDatasetSnapshot } from "../../integration/keplerBridge";
import { useMapPanel } from "../../map-panel/MapPanelContext";
import LayerPanelIcon from "./LayerPanelIcon";

type Props = {
  datasets: MaonoDatasetSnapshot[];
  onCreate: (dataset: MaonoDatasetSnapshot) => boolean;
  onImport: () => boolean;
};

function datasetMeta(dataset: MaonoDatasetSnapshot) {
  const rows =
    dataset.rowCount === null
      ? "Quantidade não informada"
      : `${dataset.rowCount.toLocaleString("pt-BR")} ${
          dataset.rowCount === 1 ? "registro" : "registros"
        }`;
  const fields = `${dataset.fields.length} ${
    dataset.fields.length === 1 ? "campo" : "campos"
  }`;

  return `${rows} · ${fields}`;
}

export default function AddLayerMenu({ datasets, onCreate, onImport }: Props) {
  const { context } = useMapPanel();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const canImportData = context?.capabilities.importData === true;
  const sortedDatasets = useMemo(
    () =>
      [...datasets].sort((left, right) =>
        left.label.localeCompare(right.label, "pt-BR", {
          sensitivity: "base",
        }),
      ),
    [datasets],
  );

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="maono-add-layer" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="maono-add-layer__trigger"
        onClick={() => setOpen((current) => !current)}
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <LayerPanelIcon name="plus" />
        <span>Adicionar camada</span>
        <LayerPanelIcon name="chevron-down" />
      </button>

      {open ? (
        <div
          id={menuId}
          className="maono-add-layer__menu"
          role="menu"
          aria-label="Adicionar camada a partir de um dataset"
        >
          <header>
            <span>Selecione os dados</span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              aria-label="Fechar menu"
            >
              <LayerPanelIcon name="x" />
            </button>
          </header>

          <div className="maono-add-layer__datasets">
            {sortedDatasets.length ? (
              sortedDatasets.map((dataset) => (
                <button
                  type="button"
                  role="menuitem"
                  key={dataset.id}
                  onClick={() => {
                    if (onCreate(dataset)) {
                      setOpen(false);
                      triggerRef.current?.focus();
                    }
                  }}
                  title={dataset.label}
                >
                  <span
                    className="maono-add-layer__dataset-icon"
                    aria-hidden="true"
                  >
                    <LayerPanelIcon name="database" />
                  </span>
                  <span>
                    <strong>{dataset.label}</strong>
                    <small>{datasetMeta(dataset)}</small>
                  </span>
                </button>
              ))
            ) : (
              <p>
                {canImportData
                  ? "Nenhum dataset disponível. Importe dados antes de criar uma camada."
                  : "Nenhum dataset existente está disponível para criar uma camada."}
              </p>
            )}
          </div>

          {canImportData ? (
            <button
              type="button"
              role="menuitem"
              className="maono-add-layer__import"
              onClick={() => {
                if (onImport()) {
                  setOpen(false);
                }
              }}
            >
              <LayerPanelIcon name="upload" />
              Importar novo dado
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
