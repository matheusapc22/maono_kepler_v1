import { useEffect, useMemo, useState } from "react";

import { can, type AccessControlUser } from "../../../access-control/can";
import { PERMISSION } from "../../../access-control/permissions";
import { MetricsSkeleton, TableSkeleton } from "../../../components/loading/Skeleton";
import {
  createOrganizationTicket,
  listOrganizationTickets,
  updateOrganizationTicket,
  type OrganizationTicket,
} from "../../../lib/api";

type TicketsSectionProps = {
  user?: AccessControlUser | null;
  organizationId?: number | string | null;
};

const INITIAL_FORM = {
  subject: "",
  description: "",
  priority: "normal",
};

const TICKET_HEADERS = ["Assunto", "Status", "Prioridade", "Criado em", "Ação"];

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function TicketsSection({ user, organizationId }: TicketsSectionProps) {
  const [tickets, setTickets] = useState<OrganizationTicket[]>([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [initialLoading, setInitialLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const permissionContext = useMemo(
    () => ({
      organizationId: organizationId ?? undefined,
      organization: organizationId ? { id: organizationId } : undefined,
    }),
    [organizationId],
  );

  const canView = can(user, PERMISSION.TICKET_VIEW, permissionContext);
  const canCreate = can(user, PERMISSION.TICKET_CREATE, permissionContext);
  const canManage = can(user, PERMISSION.TICKET_MANAGE, permissionContext);

  const openTicketsCount = tickets.filter((ticket) =>
    ["open", "new", "pending"].includes(ticket.status),
  ).length;
  const inReviewCount = tickets.filter((ticket) =>
    ["in_review", "review", "in_progress"].includes(ticket.status),
  ).length;

  async function loadTickets({ background = false } = {}) {
    if (!organizationId || !canView) {
      setTickets([]);
      return;
    }

    if (background) setRefreshing(true);
    else setInitialLoading(true);
    setError(null);

    try {
      const response = await listOrganizationTickets(organizationId);
      setTickets(response.tickets ?? []);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível carregar os chamados.",
      );
    } finally {
      if (background) setRefreshing(false);
      else setInitialLoading(false);
    }
  }

  useEffect(() => {
    setTickets([]);
    void loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, canView]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !canCreate) return;
    setSaving(true);
    setError(null);
    try {
      await createOrganizationTicket(organizationId, form);
      setForm(INITIAL_FORM);
      await loadTickets({ background: true });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível criar o chamado.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(ticket: OrganizationTicket, status: string) {
    if (!organizationId || !canManage) return;
    setError(null);
    setTickets((current) =>
      current.map((item) =>
        String(item.id) === String(ticket.id) ? { ...item, status } : item,
      ),
    );
    try {
      await updateOrganizationTicket(organizationId, ticket.id, { status });
      await loadTickets({ background: true });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível atualizar o chamado.",
      );
      await loadTickets({ background: true });
    }
  }

  if (!organizationId) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Central de Chamados</h2>
        <p>Selecione uma organização para consultar chamados.</p>
      </section>
    );
  }

  if (!canView) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Central de Chamados</h2>
        <p>Você não tem permissão para visualizar chamados desta organização.</p>
      </section>
    );
  }

  const showInitialSkeleton = initialLoading && tickets.length === 0;

  return (
    <section className="mm-card mm-section-card">
      <h2>Central de Chamados</h2>
      <p>
        Espaço para solicitações de novos mapas, envio de bases, revisão de
        previews e suporte operacional.
      </p>

      {showInitialSkeleton ? (
        <MetricsSkeleton count={3} />
      ) : (
        <div className="mm-metrics-grid compact" aria-busy={refreshing}>
          <article className="mm-card metric"><span>Chamados abertos</span><strong>{openTicketsCount}</strong></article>
          <article className="mm-card metric"><span>Total de chamados</span><strong>{tickets.length}</strong></article>
          <article className="mm-card metric"><span>Em revisão</span><strong>{inReviewCount}</strong></article>
        </div>
      )}

      {error ? <p className="mm-error-text">{error}</p> : null}

      {canCreate ? (
        <form className="projects-inline-form" onSubmit={handleSubmit}>
          <label>
            Assunto
            <input
              value={form.subject}
              maxLength={160}
              required
              onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
            />
          </label>
          <label>
            Descrição
            <textarea
              value={form.description}
              maxLength={5000}
              required
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>
          <label>
            Prioridade
            <select
              value={form.priority}
              onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
            >
              <option value="low">Baixa</option>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
            </select>
          </label>
          <button type="submit" className="mm-button" disabled={saving}>
            {saving ? "Criando..." : "Criar chamado"}
          </button>
        </form>
      ) : null}

      {showInitialSkeleton ? (
        <TableSkeleton headers={TICKET_HEADERS} rows={5} />
      ) : tickets.length === 0 ? (
        <div className="projects-empty-state">Nenhum chamado encontrado para esta organização.</div>
      ) : (
        <div className="mm-table-wrap" aria-busy={refreshing}>
          <table>
            <thead>
              <tr>{TICKET_HEADERS.map((header) => <th key={header}>{header}</th>)}</tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td>{ticket.subject}</td>
                  <td>{ticket.status}</td>
                  <td>{ticket.priority || "normal"}</td>
                  <td>{formatDate(ticket.createdAt)}</td>
                  <td>
                    {canManage ? (
                      <select
                        value={ticket.status}
                        onChange={(event) => void handleStatusChange(ticket, event.target.value)}
                      >
                        <option value="open">Aberto</option>
                        <option value="in_progress">Em andamento</option>
                        <option value="in_review">Em revisão</option>
                        <option value="closed">Fechado</option>
                      </select>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {refreshing ? (
            <span className="mm-sr-only" role="status">Atualizando chamados.</span>
          ) : null}
        </div>
      )}
    </section>
  );
}
