import { useEffect, useMemo, useState } from "react";

import { can, type AccessControlUser } from "../../../access-control/can";
import { PERMISSION } from "../../../access-control/permissions";
import {
  createOrganizationExport,
  listOrganizationExports,
  type OrganizationExport,
} from "../../../lib/api";

type ExportsSectionProps = {
  user?: AccessControlUser | null;
  organizationId?: number | string | null;
  editableProjectsCount?: number;
  readOnlyProjectsCount?: number;
};

const INITIAL_FORM = {
  type: "projects_summary",
  format: "csv",
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

export default function ExportsSection({
  user,
  organizationId,
  editableProjectsCount = 0,
  readOnlyProjectsCount = 0,
}: ExportsSectionProps) {
  const [exportsList, setExportsList] = useState<OrganizationExport[]>([]);
  const [form, setForm] = useState(INITIAL_FORM);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const permissionContext = useMemo(
    () => ({
      organizationId: organizationId ?? undefined,
      organization: organizationId ? { id: organizationId } : undefined,
    }),
    [organizationId],
  );

  const canView = can(user, PERMISSION.EXPORT_VIEW, permissionContext);
  const canCreate = can(user, PERMISSION.EXPORT_CREATE, permissionContext);
  const canDownload = can(user, PERMISSION.EXPORT_DOWNLOAD, permissionContext);

  async function loadExports() {
    if (!organizationId || !canView) {
      setExportsList([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await listOrganizationExports(organizationId);
      setExportsList(response.exports ?? []);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível carregar exportações.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadExports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, canView]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organizationId || !canCreate) {
      return;
    }

    setCreating(true);
    setError(null);

    try {
      await createOrganizationExport(organizationId, form);
      setForm(INITIAL_FORM);
      await loadExports();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível solicitar a exportação.",
      );
    } finally {
      setCreating(false);
    }
  }

  if (!organizationId) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Exportações</h2>
        <p>Selecione uma organização para consultar exportações.</p>
      </section>
    );
  }

  if (!canView) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Exportações</h2>
        <p>Você não tem permissão para visualizar exportações desta organização.</p>
      </section>
    );
  }

  return (
    <section className="mm-card mm-section-card">
      <h2>Exportações</h2>
      <p>
        Controle de exportações por organização e permissão. Viewers não
        exportam dados sensíveis por padrão.
      </p>

      <div className="mm-metrics-grid compact">
        <article className="mm-card metric">
          <span>Projetos editáveis</span>
          <strong>{editableProjectsCount}</strong>
        </article>

        <article className="mm-card metric">
          <span>Somente leitura</span>
          <strong>{readOnlyProjectsCount}</strong>
        </article>

        <article className="mm-card metric">
          <span>Exportações solicitadas</span>
          <strong>{exportsList.length}</strong>
        </article>
      </div>

      {error ? <p className="mm-error-text">{error}</p> : null}

      {canCreate ? (
        <form className="projects-inline-form" onSubmit={handleSubmit}>
          <label>
            Tipo
            <select
              value={form.type}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  type: event.target.value,
                }))
              }
            >
              <option value="projects_summary">Resumo de projetos</option>
              <option value="documents_index">Índice de documentos</option>
              <option value="tickets_summary">Resumo de chamados</option>
            </select>
          </label>

          <label>
            Formato
            <select
              value={form.format}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  format: event.target.value,
                }))
              }
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </label>

          <button type="submit" className="mm-button" disabled={creating}>
            {creating ? "Solicitando..." : "Solicitar exportação"}
          </button>
        </form>
      ) : null}

      {loading ? (
        <p>Carregando exportações...</p>
      ) : exportsList.length === 0 ? (
        <div className="projects-empty-state">
          Nenhuma exportação solicitada para esta organização.
        </div>
      ) : (
        <div className="mm-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Formato</th>
                <th>Status</th>
                <th>Criada em</th>
                <th>Download</th>
              </tr>
            </thead>

            <tbody>
              {exportsList.map((item) => (
                <tr key={item.id}>
                  <td>{item.type}</td>
                  <td>{item.format}</td>
                  <td>{item.status}</td>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    {canDownload ? (
                      <button
                        type="button"
                        className="mm-button ghost"
                        disabled
                        title="Endpoint de download de exportação ainda não foi criado."
                      >
                        Download pendente
                      </button>
                    ) : (
                      "Bloqueado"
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