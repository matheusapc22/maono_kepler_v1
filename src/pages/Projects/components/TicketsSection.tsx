import { useEffect, useMemo, useState } from "react";

import { can, type AccessControlUser } from "../../../access-control/can";
import { PERMISSION } from "../../../access-control/permissions";
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

function formatDate(value?: string) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function TicketsSection({
  user,
  organizationId,
}: TicketsSectionProps) {
  const [tickets, setTickets] = useState<OrganizationTicket[]>([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [loading, setLoading] = useState(false);
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

  async function loadTickets() {
    if (!organizationId || !canView) {
      setTickets([]);
      return;
    }

    setLoading(true);
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
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, canView]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organizationId || !canCreate) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await createOrganizationTicket(organizationId, form);
      setForm(INITIAL_FORM);
      await loadTickets();
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
    if (!organizationId || !canManage) {
      return;
    }

    setError(null);

    try {
      await updateOrganizationTicket(organizationId, ticket.id, { status });
      await loadTickets();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível atualizar o chamado.",
      );
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
          <strong>{openTicketsCount}</strong>
        </article>

        <article className="mm-card metric">
          <span>Total de chamados</span>
          <strong>{tickets.length}</strong>
        </article>

        <article className="mm-card metric">
          <span>Em revisão</span>
          <strong>{inReviewCount}</strong>
        </article>
      </div>

      {error ? <p className="mm-error-text">{error}</p> : null}

      {canCreate ? (
        <form className="projects-inline-form" onSubmit={handleSubmit}>
          <label>
            Assunto
            <input
              value={form.subject}
              maxLength={160}
              required
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  subject: event.target.value,
                }))
              }
            />
          </label>

          <label>
            Descrição
            <textarea
              value={form.description}
              maxLength={5000}
              required
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </label>

          <label>
            Prioridade
            <select
              value={form.priority}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  priority: event.target.value,
                }))
              }
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

      {loading ? (
        <p>Carregando chamados...</p>
      ) : tickets.length === 0 ? (
        <div className="projects-empty-state">
          Nenhum chamado encontrado para esta organização.
        </div>
      ) : (
        <div className="mm-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Assunto</th>
                <th>Status</th>
                <th>Prioridade</th>
                <th>Criado em</th>
                <th>Ação</th>
              </tr>
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
                        onChange={(event) =>
                          void handleStatusChange(ticket, event.target.value)
                        }
                      >
                        <option value="open">Aberto</option>
                        <option value="in_progress">Em andamento</option>
                        <option value="in_review">Em revisão</option>
                        <option value="closed">Fechado</option>
                      </select>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}