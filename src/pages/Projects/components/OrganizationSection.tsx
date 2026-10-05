import { useInitialLoadingPresentation } from "../../../components/loading/useInitialLoadingPresentation";
import { isRegionAccessDenied } from "../../../components/loading/region-loading-policy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LoadingStatus, Skeleton, StaticLoadingText } from "../../../components/loading/Skeleton";

import type { MaonoUser } from "../../../auth/session";
import {
  getOrganization,
  type OrganizationDetails,
  type OrganizationMetrics,
} from "../../../lib/api";
import { normalizeUserError } from "../../../lib/user-error-catalog";

type ApiId = number | string;

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

  if (typeof id === "number" && Number.isFinite(id)) return id;
  if (typeof id === "string" && id.trim()) return id;
  return null;
}

function getOrganizationId(user: MaonoUser | null): ApiId | null {
  const data = readObject(user);
  const directValue = data.activeOrganizationId ?? data.organizationId ?? data.organization_id ?? null;

  if (typeof directValue === "number" && Number.isFinite(directValue)) return directValue;
  if (typeof directValue === "string" && directValue.trim()) return directValue;

  return getNestedId(data.activeOrganization) ?? getNestedId(data.organization);
}

function getFallbackOrganizationName(user: MaonoUser | null): string {
  const data = readObject(user);
  const activeOrganization = readObject(data.activeOrganization);
  const organization = readObject(data.organization);
  const name = activeOrganization.name ?? organization.name;

  return typeof name === "string" && name.trim() ? name : "Organização atual";
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

function hasExplicitPermission(user: MaonoUser | null, permission: string): boolean {
  return getUserPermissions(user).includes(permission);
}

function canVisually(user: MaonoUser | null, permission: string): boolean {
  if (!user) return false;
  if (isSuperAdmin(user) || hasPlatformScope(user)) return true;
  if (hasExplicitPermission(user, permission)) return true;

  if ((isAdmin(user) || isOwner(user)) && ORGANIZATION_UI_PERMISSIONS.has(permission)) {
    return true;
  }

  return false;
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
  if (normalized === "enterprise") return "mm-tag gold";
  if (normalized === "pro") return "mm-tag green";
  return "mm-tag";
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR");
}

function formatNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("pt-BR").format(value);
}

function buildMetricItems(metrics: OrganizationMetrics | undefined, projectsCount: number): MetricItem[] {
  return [
    { key: "users", label: "Usuários", value: metrics?.users ?? 0 },
    { key: "projects", label: "Projetos", value: metrics?.projects ?? projectsCount },
    { key: "files", label: "Documentos", value: metrics?.files ?? 0 },
    { key: "tickets", label: "Chamados", value: metrics?.tickets ?? 0 },
    { key: "exports", label: "Exportações", value: metrics?.exports ?? 0 },
  ];
}

function InfoRow({ label, children, structurePending }: { label: string; children: React.ReactNode; structurePending: boolean }) {
  return <tr><th scope="row"><StaticLoadingText pending={structurePending}>{label}</StaticLoadingText></th><td>{children}</td></tr>;
}

function MetricCard({ label, value, pending, structurePending }: { label: string; value: number | undefined; pending: boolean; structurePending: boolean }) {
  return <div className="mm-card metric"><span><StaticLoadingText pending={structurePending}>{label}</StaticLoadingText></span><strong>{pending ? <Skeleton width={54} height={30} /> : value === undefined ? "—" : formatNumber(value)}</strong></div>;
}

export default function OrganizationSection(props: OrganizationSectionProps) {
  const contextKey = JSON.stringify([getOrganizationId(props.user), props.user?.id, getUserRole(props.user), getUserPermissions(props.user), getUserScopes(props.user)]);
  return <OrganizationWorkspace key={contextKey} {...props} />;
}

function OrganizationWorkspace({ user, projectsCount }: OrganizationSectionProps) {
  const organizationId = useMemo(() => getOrganizationId(user), [user]);
  const fallbackOrganizationName = useMemo(() => getFallbackOrganizationName(user), [user]);
  const permissions = useMemo(() => ({
    view: canVisually(user, "organization.view"),
    metricsView: canVisually(user, "organization.metrics.view"),
  }), [user]);

  const [organization, setOrganization] = useState<OrganizationDetails | null>(null);
  const [loading, setLoading] = useState(Boolean(organizationId && permissions.view));
  const requestRef = useRef(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { structurePending, contentPending } = useInitialLoadingPresentation({
    pending: loading, hasData: Boolean(organization), scopeKey: String(organizationId),
    failed: Boolean(errorMessage), cancelled: !organizationId || !permissions.view,
  });
  const presentationLoading = loading || contentPending;

  const loadOrganization = useCallback(async () => {
    if (!organizationId || !permissions.view) return;

    const revision = ++requestRef.current;
    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await getOrganization(organizationId);
      if (revision !== requestRef.current) return;
      setOrganization(response.organization);
    } catch (error) {
      if (revision === requestRef.current) {
        if (isRegionAccessDenied(error)) setOrganization(null);
        setErrorMessage(normalizeUserError(error).message);
      }
    } finally {
      if (revision === requestRef.current) setLoading(false);
    }
  }, [organizationId, permissions.view]);

  useEffect(() => {
    void loadOrganization();
    return () => { requestRef.current += 1; };
  }, [loadOrganization]);

  const metricItems = useMemo(
    () => buildMetricItems(organization?.metrics, projectsCount),
    [organization?.metrics, projectsCount],
  );

  if (!organizationId) {
    return <section className="mm-card mm-section-card"><h2>Organização</h2><p>Não foi possível identificar a organização ativa da sessão.</p></section>;
  }

  if (!permissions.view) {
    return <section className="mm-card mm-section-card"><h2>Organização</h2><p>Você não possui permissão para visualizar os dados desta organização.</p></section>;
  }

  return (
    <section className="mm-card mm-section-card mm-organization-section">
      <h2><StaticLoadingText pending={structurePending}>Organização</StaticLoadingText></h2>
      <p><StaticLoadingText pending={structurePending}>Resumo da organização, plano atual, status e métricas operacionais.</StaticLoadingText></p>

      {errorMessage && (
        <div className="mm-card" role="alert">
          <strong>Não foi possível carregar a organização</strong>
          <p>{errorMessage}</p>
          <button type="button" className="mm-btn" disabled={loading} onClick={() => void loadOrganization()}>Tentar novamente</button>
        </div>
      )}

      <LoadingStatus loading={presentationLoading} refreshing={Boolean(organization) && !contentPending} label="Carregando dados da organização." refreshingLabel="Atualizando dados da organização." />
      <div className="mm-section-load-region" role="region" aria-label="Dados da organização" aria-busy={presentationLoading}>
          <div className="mm-card">
            <h3><StaticLoadingText pending={structurePending}>Dados principais</StaticLoadingText></h3>
            <div className="mm-table-wrap">
              <table><tbody>
                <InfoRow structurePending={structurePending} label="Nome"><StaticLoadingText pending={structurePending}>{contentPending ? fallbackOrganizationName : organization?.name || fallbackOrganizationName}</StaticLoadingText></InfoRow>
                <InfoRow structurePending={structurePending} label="Slug">{contentPending ? <Skeleton width="58%" height={16} /> : organization?.slug || "—"}</InfoRow>
                <InfoRow structurePending={structurePending} label="Plano">{contentPending ? <Skeleton width={65} height={25} radius={999} /> : organization?.plan ? <span className={planClassName(organization.plan)}>{planLabel(organization.plan)}</span> : "—"}</InfoRow>
                <InfoRow structurePending={structurePending} label="Status">{contentPending ? <Skeleton width={65} height={25} radius={999} /> : organization ? <span className={statusClassName(organization.active)}>{statusLabel(organization.active)}</span> : "—"}</InfoRow>
                <InfoRow structurePending={structurePending} label="Criada em">{contentPending ? <Skeleton width="54%" height={16} /> : formatDate(organization?.createdAt)}</InfoRow>
                <InfoRow structurePending={structurePending} label="Atualizada em">{contentPending ? <Skeleton width="48%" height={16} /> : formatDate(organization?.updatedAt)}</InfoRow>
                <InfoRow structurePending={structurePending} label="Perfil atual"><StaticLoadingText pending={structurePending}>{user?.role || "—"}</StaticLoadingText></InfoRow>
              </tbody></table>
            </div>
          </div>

          {permissions.metricsView ? (
            <div className="mm-card">
              <h3><StaticLoadingText pending={structurePending}>Métricas</StaticLoadingText></h3>
              <div className="mm-metrics-grid compact">
                {metricItems.map((metric) => <MetricCard structurePending={structurePending} key={metric.key} label={metric.label} value={organization?.metrics?.[metric.key]} pending={contentPending} />)}
              </div>
            </div>
          ) : (
            <div className="mm-card">
              <strong><StaticLoadingText pending={structurePending}>Métricas restritas</StaticLoadingText></strong>
              <p><StaticLoadingText pending={structurePending}>Você possui acesso aos dados básicos, mas não possui permissão para consultar métricas gerenciais.</StaticLoadingText></p>
            </div>
          )}
      </div>
      <div className="mm-card">
        <h3><StaticLoadingText pending={structurePending}>Edição</StaticLoadingText></h3>
        <p><StaticLoadingText pending={structurePending}>A edição da organização ainda não está disponível nesta tela.</StaticLoadingText></p>
        <button type="button" className="mm-btn" disabled><StaticLoadingText pending={structurePending}>Editar organização</StaticLoadingText></button>
      </div>
    </section>
  );
}