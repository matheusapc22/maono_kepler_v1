import { useInitialLoadingPresentation } from "../../../components/loading/useInitialLoadingPresentation";
import { isRegionAccessDenied } from "../../../components/loading/region-loading-policy";
import { MaonoSelect } from "../../../components/selection/MaonoSelect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LoadingStatus, Skeleton, StaticLoadingText, TableSkeleton } from "../../../components/loading/Skeleton";

import type { MaonoUser } from "../../../auth/session";
import {
  createOrganizationLimitRequest,
  getOrganizationLimits,
  type CreateOrganizationLimitRequestPayload,
  type OrganizationLimitCounter,
  type OrganizationLimitRequest,
  type OrganizationLimits,
} from "../../../lib/api";
import { normalizeUserError } from "../../../lib/user-error-catalog";

type ApiId = number | string;

type LimitsPlansSectionProps = {
  user: MaonoUser | null;
  projectsCount: number;
};

type LimitItem = {
  key: keyof Omit<OrganizationLimits, "plan">;
  label: string;
  description: string;
  counter: OrganizationLimitCounter;
  unit?: string;
};

type UpgradeForm = {
  requestType: string;
  requestedPlan: string;
  reason: string;
};

const LIMITS_UI_PERMISSIONS = new Set(["limits.view", "limits.increase_request"]);

const DEFAULT_UPGRADE_FORM: UpgradeForm = {
  requestType: "plan_upgrade",
  requestedPlan: "pro",
  reason: "",
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  plan_upgrade: "Upgrade de plano",
  users_increase: "Aumento de usuários",
  projects_increase: "Aumento de projetos",
  storage_increase: "Aumento de armazenamento",
  exports_increase: "Aumento de exportações",
};

const PLAN_OPTIONS = [
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
] as const;

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
  return (isAdmin(user) || isOwner(user)) && LIMITS_UI_PERMISSIONS.has(permission);
}

function formatNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR");
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

function statusClassName(status: unknown): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "pending") return "mm-tag gold";
  if (normalized === "approved") return "mm-tag green";
  if (normalized === "rejected" || normalized === "cancelled") return "mm-tag red";
  return "mm-tag";
}

function statusLabel(status: unknown): string {
  const normalized = String(status || "pending").trim().toLowerCase();
  if (normalized === "pending") return "Em análise";
  if (normalized === "approved") return "Aprovada";
  if (normalized === "rejected") return "Não aprovada";
  if (normalized === "cancelled") return "Cancelada";
  return "Em análise";
}

function requestTypeLabel(requestType: unknown): string {
  const value = String(requestType || "").trim();
  return REQUEST_TYPE_LABELS[value] || value || "Solicitação";
}

function getUsagePercent(counter: OrganizationLimitCounter): number {
  if (!counter.limit || counter.limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((counter.used / counter.limit) * 100)));
}

function buildLimitItems(limits: OrganizationLimits | null, projectsCount: number): LimitItem[] {
  const fallbackCounter = { used: 0, limit: 0 };
  return [
    { key: "users", label: "Usuários", description: "Quantidade de usuários da organização.", counter: limits?.users ?? fallbackCounter },
    { key: "projects", label: "Projetos", description: "Projetos disponíveis para a organização.", counter: limits?.projects ?? { used: projectsCount, limit: projectsCount } },
    { key: "storageMb", label: "Armazenamento", description: "Uso agregado de armazenamento.", counter: limits?.storageMb ?? fallbackCounter, unit: "MB" },
    { key: "exports", label: "Exportações", description: "Exportações criadas pela organização.", counter: limits?.exports ?? fallbackCounter },
  ];
}

function sanitizeReason(reason: string): string {
  return reason.trim().slice(0, 1000);
}

function LimitUsageRow({ item, pending = false, available = true, structurePending }: { item: LimitItem; pending?: boolean; available?: boolean; structurePending: boolean }) {
  const percent = getUsagePercent(item.counter);
  const used = `${formatNumber(item.counter.used)}${item.unit ? ` ${item.unit}` : ""}`;
  const limit = `${formatNumber(item.counter.limit)}${item.unit ? ` ${item.unit}` : ""}`;

  return (
    <tr>
      <td><strong><StaticLoadingText pending={structurePending}>{item.label}</StaticLoadingText></strong><div className="mm-muted"><StaticLoadingText pending={structurePending}>{item.description}</StaticLoadingText></div></td>
      <td>{pending ? <Skeleton width={48} height={16} /> : available ? used : "—"}</td><td>{pending ? <Skeleton width={48} height={16} /> : available ? limit : "—"}</td>
      <td>{pending ? <Skeleton width={52} height={24} radius={999} /> : available ? <span className={percent >= 90 ? "mm-tag red" : percent >= 70 ? "mm-tag gold" : "mm-tag green"}>{percent}%</span> : "—"}</td>
    </tr>
  );
}

function PendingRequestsTable({ requests }: { requests: OrganizationLimitRequest[] }) {
  if (requests.length === 0) {
    return <div className="mm-card"><p>Não há solicitações pendentes no momento.</p></div>;
  }

  return (
    <div className="mm-table-wrap">
      <table>
        <thead><tr><th scope="col">ID</th><th scope="col">Tipo</th><th scope="col">Plano solicitado</th><th scope="col">Status</th><th scope="col">Motivo</th><th scope="col">Criado em</th></tr></thead>
        <tbody>{requests.map((request) => (
          <tr key={String(request.id)}>
            <td>{request.id}</td>
            <td>{requestTypeLabel(request.requestType)}</td>
            <td>{request.requestedPlan ? planLabel(request.requestedPlan) : "—"}</td>
            <td><span className={statusClassName(request.status)}>{statusLabel(request.status)}</span></td>
            <td>{request.reason || "—"}</td>
            <td>{formatDate(request.createdAt)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function LimitsPlansSection(props: LimitsPlansSectionProps) {
  const contextKey = JSON.stringify([getOrganizationId(props.user), props.user?.id, getUserRole(props.user), getUserPermissions(props.user), getUserScopes(props.user)]);
  return <LimitsPlansWorkspace key={contextKey} {...props} />;
}

function LimitsPlansWorkspace({ user, projectsCount }: LimitsPlansSectionProps) {
  const organizationId = useMemo(() => getOrganizationId(user), [user]);
  const permissions = useMemo(() => ({
    view: canVisually(user, "limits.view"),
    increaseRequest: canVisually(user, "limits.increase_request"),
  }), [user]);

  const [limits, setLimits] = useState<OrganizationLimits | null>(null);
  const [pendingRequests, setPendingRequests] = useState<OrganizationLimitRequest[]>([]);
  const [form, setForm] = useState<UpgradeForm>(DEFAULT_UPGRADE_FORM);
  const [loading, setLoading] = useState(Boolean(organizationId && permissions.view));
  const requestRef = useRef(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const limitItems = useMemo(() => buildLimitItems(limits, projectsCount), [limits, projectsCount]);

  const { structurePending, contentPending } = useInitialLoadingPresentation({
    pending: loading, hasData: Boolean(limits), scopeKey: String(organizationId),
    failed: Boolean(errorMessage), cancelled: !organizationId || !permissions.view,
  });
  const presentationLoading = loading || contentPending;

  const loadLimits = useCallback(async () => {
    if (!organizationId || !permissions.view) return;
    const revision = ++requestRef.current;
    setLoading(true);
    setErrorMessage(null);
    try {
      const response = await getOrganizationLimits(organizationId);
      if (revision !== requestRef.current) return;
      setLimits(response.limits);
      setPendingRequests(response.pendingRequests || []);
    } catch (error) {
      if (revision === requestRef.current) {
        if (isRegionAccessDenied(error)) { setLimits(null); setPendingRequests([]); }
        setErrorMessage(normalizeUserError(error).message);
      }
    } finally {
      if (revision === requestRef.current) setLoading(false);
    }
  }, [organizationId, permissions.view]);

  useEffect(() => {
    void loadLimits();
    return () => { requestRef.current += 1; };
  }, [loadLimits]);

  function updateForm<K extends keyof UpgradeForm>(key: K, value: UpgradeForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleCreateRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !permissions.increaseRequest) {
      setErrorMessage("Você não tem permissão para solicitar aumento de limite.");
      return;
    }

    const payload: CreateOrganizationLimitRequestPayload = {
      requestType: form.requestType,
      requestedPlan: form.requestedPlan || null,
      reason: sanitizeReason(form.reason),
    };

    if (!payload.requestType) return void setErrorMessage("Informe o tipo da solicitação.");
    if (payload.requestType === "plan_upgrade" && !payload.requestedPlan) return void setErrorMessage("Informe o plano solicitado.");
    if (!payload.reason) return void setErrorMessage("Informe o motivo da solicitação.");

    setBusyKey("create-request");
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await createOrganizationLimitRequest(organizationId, payload);
      setSuccessMessage("Solicitação enviada para análise.");
      setForm(DEFAULT_UPGRADE_FORM);
      await loadLimits();
    } catch (error) {
      setErrorMessage(normalizeUserError(error).message);
    } finally {
      setBusyKey(null);
    }
  }

  if (!organizationId) return <section className="mm-card mm-section-card"><h2>Limites e Planos</h2><p>Não foi possível identificar a organização ativa da sessão.</p></section>;
  if (!permissions.view) return <section className="mm-card mm-section-card"><h2>Limites e Planos</h2><p>Você não possui permissão para visualizar limites desta organização.</p></section>;

  return (
    <section className="mm-card mm-section-card mm-limits-section">
      <h2><StaticLoadingText pending={structurePending}>Limites e Planos</StaticLoadingText></h2>
      <p><StaticLoadingText pending={structurePending}>Acompanhe o uso atual da organização e solicite upgrade de plano ou aumento de limites.</StaticLoadingText></p>

      {errorMessage && <div className="mm-card" role="alert"><strong>Não foi possível concluir</strong><p>{errorMessage}</p><button type="button" className="mm-btn" disabled={loading} onClick={() => void loadLimits()}>Recarregar</button></div>}
      {successMessage && <div className="mm-card" role="status"><strong>Sucesso</strong><p>{successMessage}</p></div>}
      <LoadingStatus loading={presentationLoading} refreshing={Boolean(limits) && !contentPending} label="Carregando limites da organização." refreshingLabel="Atualizando limites da organização." />
      <div className="mm-section-load-region" role="region" aria-label="Limites da organização" aria-busy={presentationLoading}>
        <div className="mm-card"><h3><StaticLoadingText pending={structurePending}>Plano atual</StaticLoadingText></h3><div className="mm-tags-list">{contentPending ? <Skeleton width={65} height={25} radius={999} /> : limits?.plan ? <span className={planClassName(limits.plan)}>{planLabel(limits.plan)}</span> : "—"}</div><p><StaticLoadingText pending={structurePending}>Alterações de plano são analisadas antes de entrarem em vigor.</StaticLoadingText></p></div>

        <div className="mm-card"><h3><StaticLoadingText pending={structurePending}>Uso e limites</StaticLoadingText></h3><div className="mm-table-wrap"><table><thead><tr><th scope="col"><StaticLoadingText pending={structurePending}>Categoria</StaticLoadingText></th><th scope="col"><StaticLoadingText pending={structurePending}>Uso atual</StaticLoadingText></th><th scope="col"><StaticLoadingText pending={structurePending}>Limite</StaticLoadingText></th><th scope="col"><StaticLoadingText pending={structurePending}>Uso</StaticLoadingText></th></tr></thead><tbody>{limitItems.map((item) => <LimitUsageRow structurePending={structurePending} key={item.key} item={item} pending={contentPending} available={Boolean(limits?.[item.key])} />)}</tbody></table></div></div>

      </div>

        <div className="mm-card"><h3><StaticLoadingText pending={structurePending}>Solicitar upgrade ou aumento</StaticLoadingText></h3>
          {permissions.increaseRequest ? (
            <form onSubmit={handleCreateRequest}>
              <div className="mm-form-grid">
                <label><StaticLoadingText pending={structurePending}>Tipo</StaticLoadingText><MaonoSelect value={form.requestType} onChange={(event) => updateForm("requestType", event.target.value)}><option value="plan_upgrade">Upgrade de plano</option><option value="users_increase">Aumento de usuários</option><option value="projects_increase">Aumento de projetos</option><option value="storage_increase">Aumento de armazenamento</option><option value="exports_increase">Aumento de exportações</option></MaonoSelect></label>
                <label><StaticLoadingText pending={structurePending}>Plano solicitado</StaticLoadingText><MaonoSelect value={form.requestedPlan} onChange={(event) => updateForm("requestedPlan", event.target.value)}>{PLAN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</MaonoSelect></label>
                <label><StaticLoadingText pending={structurePending}>Motivo</StaticLoadingText><textarea value={form.reason} onChange={(event) => updateForm("reason", event.target.value)} placeholder="Explique a necessidade de aumento ou upgrade." rows={3} /></label>
              </div>
              <div className="mm-actions-row"><button type="submit" className="mm-btn primary" disabled={busyKey === "create-request"}><StaticLoadingText pending={structurePending}>{busyKey === "create-request" ? "Enviando..." : "Enviar solicitação"}</StaticLoadingText></button></div>
            </form>
          ) : <p><StaticLoadingText pending={structurePending}>Seu perfil não possui permissão para solicitar aumento de limite.</StaticLoadingText></p>}
        </div>

        <div className="mm-card" aria-busy={presentationLoading}><h3><StaticLoadingText pending={structurePending}>Solicitações pendentes</StaticLoadingText></h3>{contentPending ? <TableSkeleton structurePending={structurePending} headers={["ID", "Tipo", "Plano solicitado", "Status", "Motivo", "Criado em"]} pageSize={3} /> : limits ? <PendingRequestsTable requests={pendingRequests} /> : <p>As solicitações não puderam ser carregadas.</p>}</div>
    </section>
  );
}