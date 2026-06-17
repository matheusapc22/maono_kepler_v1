import type { MaonoUser } from "../../../auth/session";

export default function LimitsPlansSection({
  user,
  projectsCount,
}: {
  user: MaonoUser | null;
  projectsCount: number;
}) {
  const limits = user?.limits ?? {};

  return (
    <section className="mm-card mm-section-card">
      <h2>Limites e Planos</h2>
      <p>
        Limites contratados de usuários, projetos, documentos, exportações e
        funcionalidades.
      </p>

      <div className="mm-metrics-grid compact">
        <article className="mm-card metric">
          <span>Projetos</span>
          <strong>{String(limits.maxProjects ?? projectsCount)}</strong>
        </article>

        <article className="mm-card metric">
          <span>Usuários</span>
          <strong>{String(limits.maxUsers ?? "-")}</strong>
        </article>

        <article className="mm-card metric">
          <span>Exportações/mês</span>
          <strong>{String(limits.maxExportsPerMonth ?? "-")}</strong>
        </article>
      </div>
    </section>
  );
}
