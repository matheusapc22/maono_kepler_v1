import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import "./maono-map-data-sidebar.css";

const SOURCES = [
  { id: "maono", label: "Dados Maõno" },
  { id: "files", label: "Arquivos" },
  { id: "tileset", label: "Tileset" },
  { id: "url", label: "URL" },
] as const;
type SourceId = (typeof SOURCES)[number]["id"];

export type MaonoDataset = {
  id: string;
  name: string;
  description?: string;
  type?: string;
};
// No catalog/backend exists yet. Do not substitute storage files or examples.
const AVAILABLE_MAONO_DATASETS: readonly MaonoDataset[] = [];

function MaonoDataSourceList({ query }: { query: string }) {
  const datasets = AVAILABLE_MAONO_DATASETS.filter((dataset) =>
    `${dataset.name} ${dataset.description ?? ""}`
      .toLocaleLowerCase("pt-BR")
      .includes(query.trim().toLocaleLowerCase("pt-BR")),
  );
  return (
    <section className="maono-map-data-sidebar__catalog">
      <h3>Dados Maõno</h3>
      <p>Bases e dados oficiais disponibilizados pela Maõno.</p>
      {datasets.length === 0 ? (
        <p className="maono-map-data-sidebar__empty" role="status">
          Nenhuma fonte disponível no momento.
        </p>
      ) : null}
    </section>
  );
}

export default function AddDataSidebar({
  renderSource,
  busy,
  onClose,
}: {
  renderSource: (source: Exclude<SourceId, "maono">) => ReactNode;
  busy: boolean;
  onClose: () => void;
}) {
  const [activeSource, setActiveSource] = useState<SourceId>("maono");
  const [query, setQuery] = useState("");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const scroll = useRef<HTMLDivElement | null>(null);

  function selectSource(source: SourceId) {
    setActiveSource(source);
    if (scroll.current) scroll.current.scrollTop = 0;
  }
  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % SOURCES.length;
    else if (event.key === "ArrowLeft") next = (index + SOURCES.length - 1) % SOURCES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = SOURCES.length - 1;
    else return;
    event.preventDefault();
    selectSource(SOURCES[next].id);
    tabs.current[next]?.focus();
  }

  return (
    <aside id="map-add-data-sidebar" className="maono-map-data-sidebar" aria-labelledby="map-add-data-title">
      <div className="maono-map-data-sidebar__fixed">
        <header className="maono-map-data-sidebar__header">
          <div>
            <h2 id="map-add-data-title">Adicionar Dados ao Mapa</h2>
            <p>Selecione uma fonte de dados para adicionar camadas ao seu mapa.</p>
          </div>
          <button type="button" className="maono-map-data-sidebar__close" aria-label="Fechar painel" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </header>
        <label className="maono-map-data-sidebar__search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input type="search" placeholder="Buscar fonte de dados..." aria-label="Buscar fonte de dados" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="maono-map-data-sidebar__tabs" role="tablist" aria-label="Fontes de dados">
          {SOURCES.map((source, index) => (
            <button key={source.id} ref={(element) => { tabs.current[index] = element; }}
              type="button" id={`map-data-tab-${source.id}`} role="tab"
              aria-selected={activeSource === source.id} aria-controls={`map-data-source-${source.id}`}
              tabIndex={activeSource === source.id ? 0 : -1}
              onClick={() => selectSource(source.id)} onKeyDown={(event) => navigateTabs(event, index)}>
              {source.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={scroll} className="maono-map-data-sidebar__scroll maono-sidebar-scroll" tabIndex={0} aria-label="Conteúdo da fonte de dados">
        {SOURCES.map((source) => (
          <div key={source.id} role="tabpanel" id={`map-data-source-${source.id}`} aria-labelledby={`map-data-tab-${source.id}`}
            hidden={activeSource !== source.id} aria-busy={activeSource === source.id && busy}>
            {activeSource === source.id ? <>
              {busy ? <p className="maono-map-data-sidebar__loading" role="status">Carregando dados…</p> : null}
              {source.id === "maono" ? <MaonoDataSourceList query={query} /> : (
                <div className={`maono-map-data-sidebar__source maono-map-data-sidebar__source--${source.id}`}>
                  {renderSource(source.id)}
                </div>
              )}
            </> : null}
          </div>
        ))}
      </div>
    </aside>
  );
}
