export default function AdminShortcutSection() {
  return (
    <section className="mm-card mm-section-card">
      <h2>Administração Maõno</h2>
      <p>
        Atalhos administrativos da plataforma. Esta área é apenas uma entrada de
        interface; rotas e endpoints administrativos precisam continuar
        protegidos no backend.
      </p>

      <div className="mm-code-panel">
        /admin<br />
        /admin/files<br />
        Auditoria, organizações, usuários e projetos exigem permissão no backend.
      </div>
    </section>
  );
}
