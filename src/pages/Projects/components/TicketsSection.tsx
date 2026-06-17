export default function TicketsSection() {
  return (
    <section className="mm-card mm-section-card">
      <h2>Central de Chamados</h2>
      <p>
        Espaço para solicitações de novos mapas, envio de bases, revisão de
        previews e suporte operacional.
      </p>

      <div className="mm-metrics-grid compact">
        <article className="mm-card metric">
          <span>Chamados abertos</span>
          <strong>0</strong>
        </article>

        <article className="mm-card metric">
          <span>Uploads pendentes</span>
          <strong>0</strong>
        </article>

        <article className="mm-card metric">
          <span>Em revisão</span>
          <strong>0</strong>
        </article>
      </div>
    </section>
  );
}
