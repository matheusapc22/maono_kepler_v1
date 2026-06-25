import { useCallback, useEffect, useMemo, useState } from "react";

import type { MaonoUser } from "../../../auth/session";
import {
  getOrganization,
  type OrganizationDetails,
  type OrganizationMetrics,
} from "../../../lib/api";

type ApiId = number | string;

type ApiErrorLike = Error & {
  status?: number;
  code?: string;
  payload?: unknown;
};

type OrganizationSectionProps = {
  user: MaonoUser | null;
  projectsCount: number;
};

type MetricItem = {
  key: keyof OrganizationMetrics;
  label: string;
  value: number;
};

const ORGANIZATION_UI_PERMISSIONS = new Set([
  "organization.view",
  "organization.metrics.view",
]);

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeRole(role: unknown): string {
  return String(role || "viewer").trim().toLowerCase();
}

function getNestedId(value: unknown): ApiId | null {
  const data = readObject(value);
  const id = data.id;

  if (typeof id === "number" && Number.isFinite(id)) {
    return id;
  }

  if (typeof id === "string" && id.trim()) {
    return id;
  }

  return null;
}

function getOrganizationId(user: MaonoUser | null): ApiId | null {
  const data = readObject(user);

  const directValue =
    data.activeOrganizationId ??
    data.organizationId ??
    data.organization_id ??
    null;

  if (typeof directValue === "number" && Number.isFinite(directValue)) {
    return directValue;
  }

  if (typeof directValue === "string" && directValue.trim()) {
    return directValue;
  }

  return getNestedId(data.activeOrganization) ?? getNestedId(data.organization);
}

function getFallbackOrganizationName(user: MaonoUser | null): string {
  const data = readObject(user);
  const activeOrganization = readObject(data.activeOrganization);
  const organization = readObject(data.organization);

  const name = activeOrganization.name ?? organization.name;

  return typeof name === "string" && name.trim()
    ? name
    : "Organização atual";
}

function getUserRole(user: MaonoUser | null): string {
  return normalizeRole(readObject(user).role);
}

function getUserPermissions(user: MaonoUser | null): string[] {
  return readStringArray(readObject(user).permissions);
}

function getUserScopes(user: MaonoUser | null): string[] {
  return readStringArray(readObject(user).scopes);
}

function isSuperAdmin(user: MaonoUser | null): boolean {
  return getUserRole(user) === "super_admin";
}

function isAdmin(user: MaonoUser | null): boolean {
  return getUserRole(user) === "admin";
}

function isOwner(user: MaonoUser | null): boolean {
  const role = getUserRole(user);

  return role === "owner" || role === "client";
}

function hasPlatformScope(user: MaonoUser | null): boolean {
  return getUserScopes(user).includes("platform:*");
}

function hasExplicitPermission(
  user: MaonoUser | null,
  permission: string,
): boolean {
  return getUserPermissions(user).includes(permission);
}

function canVisually(user: MaonoUser | null, permission: string): boolean {
  if (!user) {
    return false;
  }

  if (isSuperAdmin(user) || hasPlatformScope(user)) {
    return true;
  }

  if (hasExplicitPermission(user, permission)) {
    return true;
  }

  if (
    (isAdmin(user) || isOwner(user)) &&
    ORGANIZATION_UI_PERMISSIONS.has(permission)
  ) {
    return true;
  }

  return false;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const apiError = error as ApiErrorLike;

    const prefix = [
      typeof apiError.status === "number" ? `HTTP ${apiError.status}` : null,
      apiError.code || null,
    ]
      .filter(Boolean)
      .join(" · ");

    return prefix ? `${prefix}: ${error.message}` : error.message;
  }

  return "Não foi possível carregar os dados da organização.";
}

function statusLabel(active: unknown): string {
  return active === false ? "Inativa" : "Ativa";
}

function statusClassName(active: unknown): string {
  return active === false ? "mm-tag red" : "mm-tag green";
}

function planLabel(plan: unknown): string {
  const normalized = String(plan || "free").trim().toLowerCase();

  if (normalized === "free") return "Free";
  if (normalized === "pro") return "Pro";
  if (normalized === "enterprise") return "Enterprise";

  return String(plan || "Free");
}

function planClassName(plan: unknown): string {
  const normalized = String(plan || "free").trim().toLowerCase();

  if (normalized === "enterprise") {
    return "mm-tag gold";
  }

  if (normalized === "pro") {
    return "mm-tag green";
  }

  return "mm-tag";
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("pt-BR");
}

function formatNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0";
  }

  return new Intl.NumberFormat("pt-BR").format(value);
}

function buildMetricItems(
  metrics: OrganizationMetrics | undefined,
  projectsCount: number,
): MetricItem[] {
  return [
    {
      key: "users",
      label: "Usuários",
      value: metrics?.users ?? 0,
    },
    {
      key: "projects",
      label: "Projetos",
      value: metrics?.projects ?? projectsCount,
    },
    {
      key: "files",
      label: "Documentos",
      value: metrics?.files ?? 0,
    },
    {
      key: "tickets",
      label: "Chamados",
      value: metrics?.tickets ?? 0,
    },
    {
      key: "exports",
      label: "Exportações",
      value: metrics?.exports ?? 0,
    },
  ];
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <th>{label}</th>
      <td>{children}</td>
    </tr>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="mm-card metric">
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

export default function OrganizationSection({
  user,
  projectsCount,
}: OrganizationSectionProps) {
  const organizationId = useMemo(() => getOrganizationId(user), [user]);

  const fallbackOrganizationName = useMemo(
    () => getFallbackOrganizationName(user),
    [user],
  );

  const permissions = useMemo(
    () => ({
      view: canVisually(user, "organization.view"),
      metricsView: canVisually(user, "organization.metrics.view"),
    }),
    [user],
  );

  const [organization, setOrganization] = useState<OrganizationDetails | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadOrganization = useCallback(async () => {
    if (!organizationId || !permissions.view) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await getOrganization(organizationId);
      setOrganization(response.organization);
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setLoading(false);
    }
  }, [organizationId, permissions.view]);

  useEffect(() => {
    void loadOrganization();
  }, [loadOrganization]);

  const metricItems = useMemo(
    () => buildMetricItems(organization?.metrics, projectsCount),
    [organization?.metrics, projectsCount],
  );

  if (!organizationId) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Organização</h2>
        <p>Não foi possível identificar a organização ativa da sessão.</p>
      </section>
    );
  }

  if (!permissions.view) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Organização</h2>
        <p>
          Você não possui permissão para visualizar os dados desta organização.
        </p>
      </section>
    );
  }

  return (
    <section className="mm-card mm-section-card">
      <h2>Organização</h2>
      <p>
        Resumo da organização cliente, plano atual, status e métricas
        operacionais. Nesta sprint, a edição permanece somente leitura.
      </p>

      {errorMessage && (
        <div className="mm-card" role="alert">
          <strong>Erro</strong>
          <p>{errorMessage}</p>

          <button
            type="button"
            className="mm-btn"
            onClick={() => {
              void loadOrganization();
            }}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {loading && (
        <div className="mm-card">
          <p>Carregando dados da organização...</p>
        </div>
      )}

      {!loading && (
        <>
          <div className="mm-card">
            <h3>Dados principais</h3>

            <div className="mm-table-wrap">
              <table>
                <tbody>
                  <InfoRow label="Nome">
                    {organization?.name || fallbackOrganizationName}
                  </InfoRow>

                  <InfoRow label="Slug">{organization?.slug || "—"}</InfoRow>

                  <InfoRow label="Plano">
                    <span className={planClassName(organization?.plan)}>
                      {planLabel(organization?.plan)}
                    </span>
                  </InfoRow>

                  <InfoRow label="Status">
                    <span className={statusClassName(organization?.active)}>
                      {statusLabel(organization?.active)}
                    </span>
                  </InfoRow>

                  <InfoRow label="Criada em">
                    {formatDate(organization?.createdAt)}
                  </InfoRow>

                  <InfoRow label="Atualizada em">
                    {formatDate(organization?.updatedAt)}
                  </InfoRow>

                  <InfoRow label="Perfil atual">
                    {user?.role || "—"}
                  </InfoRow>
                </tbody>
              </table>
            </div>
          </div>

          {permissions.metricsView ? (
            <div className="mm-card">
              <h3>Métricas</h3>

              <div className="mm-metrics-grid compact">
                {metricItems.map((metric) => (
                  <MetricCard
                    key={metric.key}
                    label={metric.label}
                    value={metric.value}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="mm-card">
              <strong>Métricas restritas</strong>
              <p>
                Você possui acesso aos dados básicos, mas não possui permissão
                visual para consultar métricas gerenciais.
              </p>
            </div>
          )}

          <div className="mm-card">
            <h3>Edição</h3>
            <p>
              A edição da organização será implementada em sprint futura. O
              endpoint <code>PATCH /api/organizations/:id</code> não faz parte
              do escopo da Sprint 8.
            </p>

            <button type="button" className="mm-btn" disabled>
              Editar organização
            </button>
          </div>

          <div className="mm-card">
            <strong>Permissões visuais nesta tela</strong>

            <div className="mm-tags-list">
              <span
                className={permissions.view ? "mm-tag green" : "mm-tag red"}
              >
                organization.view
              </span>

              <span
                className={
                  permissions.metricsView ? "mm-tag green" : "mm-tag red"
                }
              >
                organization.metrics.view
              </span>
            </div>

            <p>
              Estes indicadores servem apenas para orientar a interface. As
              permissões reais continuam sendo validadas pelos endpoints da API.
            </p>
          </div>
        </>
      )}
    </section>
  );
}