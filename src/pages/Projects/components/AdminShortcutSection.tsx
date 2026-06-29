import { Link } from "react-router";

export default function AdminShortcutSection() {
  return (
    <section className="mm-card mm-section-card">
      <div className="mm-section-header">
        <div>
          <p className="mm-eyebrow">Administração Maõno</p>
          <h2>Painel Admin</h2>
        </div>
      </div>

      <p>
        Esta seção dentro de <strong>/projects</strong> funciona apenas como um
        atalho para o painel administrativo da plataforma. Ela não substitui o
        painel completo, não carrega dados administrativos e não concede acesso
        por si só.
      </p>

      <div className="mm-code-panel">
        <strong>Rotas administrativas principais</strong>
        <br />
        /admin
        <br />
        /admin/files
        <br />
        /api/admin/*
      </div>

      <div className="mm-code-panel">
        <strong>Permissão exigida</strong>
        <br />
        admin.panel.access
      </div>

      <p className="mm-muted">
        A visibilidade deste atalho é apenas controle visual. O acesso real a
        rotas e endpoints administrativos deve continuar protegido em
        <strong> Routes.tsx</strong>, páginas admin e backend.
      </p>

      <div className="mm-actions-row">
        <Link to="/admin" className="mm-btn primary">
          Abrir Painel Admin
        </Link>
      </div>
    </section>
  );
}