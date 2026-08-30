import { useEffect, useState } from "react";

import type {
  MaonoBasemapController,
  MaonoBasemapStyleOption,
} from "../../engine-adapter/basemap-controller.ts";
import type { MapRuntimeMode } from "../../map-panel/types.ts";
import "./maono-basemap-panel.css";

type MaonoBasemapPanelProps = {
  controller: MaonoBasemapController;
  mode: MapRuntimeMode;
};

function visualTone(style: MaonoBasemapStyleOption) {
  const id = style.id.toLocaleLowerCase();
  if (id.includes("night") || id.includes("dark")) return "dark";
  if (id.includes("light")) return "light";
  if (id.includes("muted")) return "muted";
  return "custom";
}

function persistenceMessage(mode: MapRuntimeMode) {
  if (mode === "viewer") {
    return "No modo de visualização, a escolha vale somente para esta sessão e não altera o projeto salvo.";
  }

  if (mode === "create") {
    return "O mapa-base selecionado será incluído na configuração do novo mapa.";
  }

  return "A escolha entra nas alterações do mapa e será persistida quando você salvar o projeto.";
}

export default function MaonoBasemapPanel({
  controller,
  mode,
}: MaonoBasemapPanelProps) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [controller.currentStyleId]);

  return (
    <aside
      id="maono-basemap-panel"
      className="maono-basemap-panel"
      aria-label="Mapa base"
    >
      <header className="maono-basemap-panel__header">
        <div>
          <span>Visual do mapa</span>
          <h2>Mapa base</h2>
        </div>
        <p>
          Troque o fundo cartográfico sem alterar suas camadas, filtros ou
          análises.
        </p>
      </header>

      <div
        className="maono-basemap-panel__styles"
        role="radiogroup"
        aria-label="Estilos disponíveis de mapa base"
        aria-busy={controller.loading}
      >
        {controller.loading ? (
          <div className="maono-basemap-panel__state" role="status">
            Carregando mapas base…
          </div>
        ) : controller.styles.length ? (
          controller.styles.map((style) => (
            <button
              key={style.id}
              type="button"
              className={[
                "maono-basemap-panel__option",
                style.selected ? "is-selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="radio"
              aria-checked={style.selected}
              onClick={() => {
                setError(null);
                const result = controller.selectStyle(style.id);
                if (!result.ok) {
                  setError(result.reason);
                }
              }}
            >
              <span
                className="maono-basemap-panel__preview"
                data-basemap-tone={visualTone(style)}
                aria-hidden="true"
              >
                <i />
                <i />
                <i />
              </span>
              <span className="maono-basemap-panel__option-copy">
                <strong>{style.label}</strong>
                <small>
                  {style.source === "default"
                    ? "Mapa base padrão"
                    : "Mapa base personalizado"}
                </small>
              </span>
              <span
                className="maono-basemap-panel__selection"
                aria-hidden="true"
              >
                {style.selected ? "✓" : ""}
              </span>
            </button>
          ))
        ) : (
          <div className="maono-basemap-panel__state" role="status">
            Nenhum mapa base está disponível neste momento.
          </div>
        )}
      </div>

      {error ? (
        <div className="maono-basemap-panel__error" role="alert">
          {error}
        </div>
      ) : null}

      <footer className="maono-basemap-panel__footer">
        <span aria-hidden="true">i</span>
        <p>{persistenceMessage(mode)}</p>
      </footer>
    </aside>
  );
}
