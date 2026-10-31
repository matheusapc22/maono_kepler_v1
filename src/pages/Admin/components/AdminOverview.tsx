import { StaticLoadingText } from "../../../components/loading";
import { Skeleton } from "../../../components/loading/Skeleton";
import AdminIcon, { type AdminIconName } from "./AdminIcon";
import { overviewMetricPresentation } from "./admin-overview-model";
import "../admin-overview-provenance.css";

type AdminOverviewMetric = {
  label: string;
  value: number;
  icon: AdminIconName;
  state: { pending: boolean; loaded: boolean; error?: string };
  available?: boolean;
  contentPending: boolean;
};

type AdminOverviewProps = {
  metrics: AdminOverviewMetric[];
  structurePending: boolean;
  onSection: (section: "organizations" | "projects" | "audit") => void;
};

const shortcuts = [
  { section: "organizations", title: "Gestão de Organizações", description: "Consultar organizações e seus vínculos.", action: "Abrir organizações", icon: "building" },
  { section: "projects", title: "Projetos e Mapas", description: "Consultar projetos, mapas e contexto de acesso.", action: "Abrir projetos", icon: "map" },
  { section: "audit", title: "Auditoria", description: "Abrir a subaba de auditoria e seus limites.", action: "Abrir auditoria", icon: "audit" },
] as const;

export default function AdminOverview({ metrics, structurePending, onSection }: AdminOverviewProps) {
  return (
    <section className="admin-overview" aria-label="Visão geral da plataforma">
      <section className="mm-metrics-grid admin-overview-metrics" aria-label="Indicadores da plataforma">
        {metrics.map(metric => {
          const presentation = overviewMetricPresentation(metric);
          return (
          <article className="mm-card metric admin-overview-metric" aria-busy={metric.state.pending || metric.contentPending} key={metric.label}>
            <div className="admin-overview-metric-copy">
              <span><StaticLoadingText pending={structurePending}>{metric.label}</StaticLoadingText></span>
              {metric.contentPending ? <Skeleton width={54} height={40} /> : presentation.value !== null ? <strong>{presentation.value}</strong> : <strong aria-label="Indisponível">—</strong>}
              {!metric.contentPending && presentation.note && <p className="admin-overview-metric-note">{presentation.note}</p>}
            </div>
            <AdminIcon name={metric.icon} />
          </article>
        ); })}
      </section>

      <details className="admin-overview-provenance">
        <summary>Escopo e origem dos indicadores</summary>
        <p>Contagens administrativas globais da última leitura nesta sessão. Não são indicadores de atividade em tempo real. Cada região carrega de forma independente.</p>
        <dl>
          <div><dt>Organizações</dt><dd>Cadastros ativos retornados por /api/admin/organizations.</dd></div>
          <div><dt>Projetos</dt><dd>Cadastros ativos retornados por /api/admin/projects.</dd></div>
          <div><dt>Usuários</dt><dd>Cadastros ativos de /api/admin/users. O contrato legado pode obter a lista de /api/admin/access quando a lista de usuários é omitida.</dd></div>
          <div><dt>Arquivos</dt><dd>Soma de fileCount de todas as organizações retornadas, inclusive inativas. A API conta registros ativos em organization_files; não mede arquivos físicos, espaço ou disponibilidade no Dropbox.</dd></div>
        </dl>
        <p>Zero só é mostrado para uma leitura válida sem registros correspondentes. Falhas transitórias podem manter números anteriores, identificados no cartão. Acesso negado ou recurso indisponível remove os dados da região.</p>
      </details>

      <section className="admin-overview-shortcuts" aria-labelledby="admin-shortcuts-title">
        <h2 id="admin-shortcuts-title"><StaticLoadingText pending={structurePending}>Acesso rápido</StaticLoadingText></h2>
        <div className="admin-command-grid admin-overview-shortcuts-grid">
          {shortcuts.map(shortcut => (
            <article className="mm-card mm-section-card admin-overview-shortcut" key={shortcut.section}>
              <div className="admin-overview-shortcut-heading">
                <AdminIcon name={shortcut.icon} />
                <div>
                  <h3><StaticLoadingText pending={structurePending}>{shortcut.title}</StaticLoadingText></h3>
                  <p><StaticLoadingText pending={structurePending}>{shortcut.description}</StaticLoadingText></p>
                </div>
              </div>
              <button className="mm-btn admin-overview-shortcut-action" type="button" onClick={() => onSection(shortcut.section)}>
                <span><StaticLoadingText pending={structurePending}>{shortcut.action}</StaticLoadingText></span>
                <AdminIcon name="arrow-right" />
              </button>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
