import { StaticLoadingText } from "../../../components/loading";
import { Skeleton } from "../../../components/loading/Skeleton";
import AdminIcon, { type AdminIconName } from "./AdminIcon";

type AdminOverviewMetric = {
  label: string;
  value: number;
  icon: AdminIconName;
  state: { pending: boolean; loaded: boolean };
  contentPending: boolean;
};

type AdminOverviewProps = {
  metrics: AdminOverviewMetric[];
  structurePending: boolean;
  onSection: (section: "organizations" | "projects" | "audit") => void;
};

const shortcuts = [
  { section: "organizations", title: "Gestão de Organizações", description: "Organizações, documentos, projetos e limites.", action: "Abrir organizações", icon: "building" },
  { section: "projects", title: "Projetos e Mapas", description: "Mapas, vínculos, previews e configurações.", action: "Abrir projetos", icon: "map" },
  { section: "audit", title: "Auditoria", description: "Eventos, bloqueios e ações administrativas.", action: "Abrir auditoria", icon: "audit" },
] as const;

export default function AdminOverview({ metrics, structurePending, onSection }: AdminOverviewProps) {
  return (
    <section className="admin-overview" aria-label="Visão geral da plataforma">
      <section className="mm-metrics-grid admin-overview-metrics" aria-label="Indicadores da plataforma">
        {metrics.map(metric => (
          <article className="mm-card metric admin-overview-metric" aria-busy={metric.state.pending || metric.contentPending} key={metric.label}>
            <div className="admin-overview-metric-copy">
              <span><StaticLoadingText pending={structurePending}>{metric.label}</StaticLoadingText></span>
              {metric.contentPending ? <Skeleton width={54} height={40} /> : metric.state.loaded ? <strong>{metric.value}</strong> : <strong aria-label="Indisponível">—</strong>}
            </div>
            <AdminIcon name={metric.icon} />
          </article>
        ))}
      </section>

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
