import { Link } from "react-router";
import { useSession } from "../../../auth/session";
import { adminTicketDestination } from "./admin-request-navigation";
import "../admin-requests.css";

export default function AdminRequests({ sessionAvailable }: { sessionAvailable: boolean }) {
  const { authenticated, loading, user, activeOrganization, organizations } = useSession();
  const available = sessionAvailable && authenticated && !loading && user?.role === "super_admin";
  const destination = available ? adminTicketDestination(user, activeOrganization, organizations) : null;

  return (
    <section className="admin-requests" aria-labelledby="admin-requests-title">
      <div className="mm-card mm-section-card">
        <h2 id="admin-requests-title">Solicitações</h2>
        <p>Chamados e revisões de mapas têm fluxos separados. Consulte os registros e seus estados nos destinos abaixo.</p>
        <p>Este painel não consolida contagens de solicitações.</p>
      </div>
      <div className="admin-requests-grid">
        <article className="mm-card mm-section-card" aria-labelledby="admin-tickets-title">
          <h3 id="admin-tickets-title">Central de Chamados</h3>
          <p>Suporte, pedidos e acompanhamento por organização. Filtros, responsáveis, comentários e histórico continuam na Central.</p>
          {destination ? <>
            <p>Organização ativa: <strong>{destination.organizationName}</strong></p>
            <Link className="mm-btn" tabIndex={0} to={destination.href}>Abrir chamados da organização</Link>
          </> : <p role="status">Chamados indisponíveis neste contexto. Abra Projetos e selecione uma organização disponível na sua sessão.</p>}
          <p>Para outra organização, selecione o contexto em Projetos antes de abrir a Central de Chamados.</p>
        </article>
        <article className="mm-card mm-section-card" aria-labelledby="admin-map-requests-title">
          <h3 id="admin-map-requests-title">Revisões de mapas</h3>
          <p>Propostas de alteração são consultadas por projeto. Abra um projeto autorizado para acessar suas solicitações de revisão.</p>
          <p>A revisão e a aplicação de propostas permanecem no fluxo do mapa, com verificação de acesso própria.</p>
          {available && <Link className="mm-btn" tabIndex={0} to="/projects">Abrir projetos</Link>}
        </article>
      </div>
    </section>
  );
}
