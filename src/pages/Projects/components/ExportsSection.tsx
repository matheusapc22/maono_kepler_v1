export default function ExportsSection({
  editableProjectsCount,
  readOnlyProjectsCount,
}: {
  editableProjectsCount: number;
  readOnlyProjectsCount: number;
}) {
  return (
    <section className="mm-card mm-section-card">
      <h2>Exportações</h2>
      <p>
        Controle de exportações por projeto e permissão. Viewers não exportam
        dados sensíveis por padrão.
      </p>

      <div className="mm-metrics-grid compact">
        <article className="mm-card metric">
          <span>Exportação liberada</span>
          <strong>{editableProjectsCount}</strong>
        </article>

        <article className="mm-card metric">
          <span>Bloqueadas</span>
          <strong>{readOnlyProjectsCount}</strong>
        </article>
      </div>
    </section>
  );
}
