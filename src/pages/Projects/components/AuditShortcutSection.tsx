import { Link } from "react-router";

export default function AuditShortcutSection() {
  return (
    <section className="mm-card mm-section-card">
      <div className="mm-section-header">
        <div>
          <p className="mm-eyebrow">Administração Maõno</p>
          <h2>Auditoria</h2>
        </div>
      </div>

      <p>
        Esta seção dentro de <strong>/projects</strong> funciona como uma
        entrada visual para auditoria. Ela não lista eventos sensíveis
        diretamente e não substitui as telas administrativas dedicadas.
      </p>

      <div className="projects-management-grid">
        <div className="projects-management-card">
          <h3>Auditoria de organização</h3>
          <p>
            Registros relacionados a ações dentro de uma organização, como
            alterações de acesso, uploads, exportações, chamados e mudanças em
            projetos, devem respeitar o escopo organizacional do usuário.
          </p>

          <div className="mm-code-panel">
            <strong>Permissões relacionadas</strong>
            <br />
            audit.view
            <br />
            audit.organization.view
            <br />
            audit.export
          </div>
        </div>

        <div className="projects-management-card">
          <h3>Auditoria de plataforma</h3>
          <p>
            Registros globais ou de segurança da plataforma são administrativos
            e devem ficar restritos a perfis autorizados, como Super Admin ou
            Admin com permissão e escopo adequados.
          </p>

          <div className="mm-code-panel">
            <strong>Permissões relacionadas</strong>
            <br />
            audit.platform.view
            <br />
            audit.security.view
          </div>
        </div>
      </div>

      <div className="mm-code-panel">
        <strong>Permissão base visual</strong>
        <br />
        audit.view
      </div>

      <p className="mm-muted">
        A visibilidade deste atalho é apenas controle visual. A consulta real
        de eventos deve passar por <strong>/api/audit</strong> com validação de
        permissão, escopo e filtros no backend.
      </p>

      <div className="mm-actions-row">
        <Link to="/admin" className="mm-btn primary">
          Abrir área administrativa
        </Link>
      </div>
    </section>
  );
}