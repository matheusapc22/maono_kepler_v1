export default function AuditShortcutSection() {
  return (
    <section className="mm-card mm-section-card">
      <h2>Auditoria</h2>
      <p>
        Eventos sensíveis: abertura de mapa, salvamentos, tentativas bloqueadas,
        exportações e uploads.
      </p>

      <div className="mm-audit-list">
        <div>
          <strong>projects.open</strong>
          <span>Projeto aberto pelo usuário atual.</span>
        </div>

        <div>
          <strong>projects.thumbnail</strong>
          <span>Preview PNG usado na tela inicial quando disponível.</span>
        </div>
      </div>
    </section>
  );
}
