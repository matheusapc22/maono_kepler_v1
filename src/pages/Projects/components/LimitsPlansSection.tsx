import { useCallback, useEffect, useMemo, useState } from "react";

import type { MaonoUser } from "../../../auth/session";
import {
  createOrganizationLimitRequest,
  getOrganizationLimits,
  type CreateOrganizationLimitRequestPayload,
  type OrganizationLimitCounter,
  type OrganizationLimitRequest,
  type OrganizationLimits,
} from "../../../lib/api";

type ApiId = number | string;

type ApiErrorLike = Error & {
  status?: number;
  code?: string;
  payload?: unknown;
};

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

const LIMITS_UI_PERMISSIONS = new Set([
  "limits.view",
  "limits.increase_request",
]);

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
  {
    value: "pro",
    label: "Pro",
  },
  {
    value: "enterprise",
    label: "Enterprise",
  },
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

  if ((isAdmin(user) || isOwner(user)) && LIMITS_UI_PERMISSIONS.has(permission)) {
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

  return "Não foi possível concluir a operação.";
}

function formatNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0";
  }

  return new Intl.NumberFormat("pt-BR").format(value);
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

function statusClassName(status: unknown): string {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "pending") {
    return "mm-tag gold";
  }

  if (normalized === "approved") {
    return "mm-tag green";
  }

  if (normalized === "rejected" || normalized === "cancelled") {
    return "mm-tag red";
  }

  return "mm-tag";
}

function requestTypeLabel(requestType: unknown): string {
  const value = String(requestType || "").trim();

  return REQUEST_TYPE_LABELS[value] || value || "Solicitação";
}

function getUsagePercent(counter: OrganizationLimitCounter): number {
  if (!counter.limit || counter.limit <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, Math.round((counter.used / counter.limit) * 100)),
  );
}

function buildLimitItems(
  limits: OrganizationLimits | null,
  projectsCount: number,
): LimitItem[] {
  const fallbackCounter = {
    used: 0,
    limit: 0,
  };

  return [
    {
      key: "users",
      label: "Usuários",
      description: "Quantidade de usuários da organização.",
      counter: limits?.users ?? fallbackCounter,
    },
    {
      key: "projects",
      label: "Projetos",
      description: "Projetos disponíveis para a organização.",
      counter: limits?.projects ?? {
        used: projectsCount,
        limit: projectsCount,
      },
    },
    {
      key: "storageMb",
      label: "Armazenamento",
      description: "Uso agregado de armazenamento sem expor caminhos internos.",
      counter: limits?.storageMb ?? fallbackCounter,
      unit: "MB",
    },
    {
      key: "exports",
      label: "Exportações",
      description: "Exportações criadas pela organização.",
      counter: limits?.exports ?? fallbackCounter,
    },
  ];
}

function sanitizeReason(reason: string): string {
  return reason.trim().slice(0, 1000);
}

function LimitUsageRow({ item }: { item: LimitItem }) {
  const percent = getUsagePercent(item.counter);
  const used = `${formatNumber(item.counter.used)}${
    item.unit ? ` ${item.unit}` : ""
  }`;
  const limit = `${formatNumber(item.counter.limit)}${
    item.unit ? ` ${item.unit}` : ""
  }`;

  return (
    <tr>
      <td>
        <strong>{item.label}</strong>
        <div className="mm-muted">{item.description}</div>
      </td>

      <td>{used}</td>
      <td>{limit}</td>

      <td>
        <span
          className={
            percent >= 90
              ? "mm-tag red"
              : percent >= 70
                ? "mm-tag gold"
                : "mm-tag green"
          }
        >
          {percent}%
        </span>
      </td>
    </tr>
  );
}

function PendingRequestsTable({
  requests,
}: {
  requests: OrganizationLimitRequest[];
}) {
  if (requests.length === 0) {
    return (
      <div className="mm-card">
        <p>Não há solicitações pendentes no momento.</p>
      </div>
    );
  }

  return (
    <div className="mm-table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Tipo</th>
            <th>Plano solicitado</th>
            <th>Status</th>
            <th>Motivo</th>
            <th>Criado em</th>
          </tr>
        </thead>

        <tbody>
          {requests.map((request) => (
            <tr key={String(request.id)}>
              <td>{request.id}</td>
              <td>{requestTypeLabel(request.requestType)}</td>
              <td>
                {request.requestedPlan
                  ? planLabel(request.requestedPlan)
                  : "—"}
              </td>
              <td>
                <span className={statusClassName(request.status)}>
                  {request.status || "pending"}
                </span>
              </td>
              <td>{request.reason || "—"}</td>
              <td>{formatDate(request.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LimitsPlansSection({
  user,
  projectsCount,
}: LimitsPlansSectionProps) {
  const organizationId = useMemo(() => getOrganizationId(user), [user]);

  const permissions = useMemo(
    () => ({
      view: canVisually(user, "limits.view"),
      increaseRequest: canVisually(user, "limits.increase_request"),
    }),
    [user],
  );

  const [limits, setLimits] = useState<OrganizationLimits | null>(null);
  const [pendingRequests, setPendingRequests] = useState<
    OrganizationLimitRequest[]
  >([]);
  const [form, setForm] = useState<UpgradeForm>(DEFAULT_UPGRADE_FORM);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const limitItems = useMemo(
    () => buildLimitItems(limits, projectsCount),
    [limits, projectsCount],
  );

  const loadLimits = useCallback(async () => {
    if (!organizationId || !permissions.view) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await getOrganizationLimits(organizationId);

      setLimits(response.limits);
      setPendingRequests(response.pendingRequests || []);
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setLoading(false);
    }
  }, [organizationId, permissions.view]);

  useEffect(() => {
    void loadLimits();
  }, [loadLimits]);

  function updateForm<K extends keyof UpgradeForm>(
    key: K,
    value: UpgradeForm[K],
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
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

    if (!payload.requestType) {
      setErrorMessage("Informe o tipo da solicitação.");
      return;
    }

    if (payload.requestType === "plan_upgrade" && !payload.requestedPlan) {
      setErrorMessage("Informe o plano solicitado.");
      return;
    }

    if (!payload.reason) {
      setErrorMessage("Informe o motivo da solicitação.");
      return;
    }

    setBusyKey("create-request");
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await createOrganizationLimitRequest(organizationId, payload);

      setSuccessMessage(
        "Solicitação criada com status pending. O plano e os limites não foram alterados.",
      );
      setForm(DEFAULT_UPGRADE_FORM);

      await loadLimits();
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setBusyKey(null);
    }
  }

  if (!organizationId) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Limites e Planos</h2>
        <p>Não foi possível identificar a organização ativa da sessão.</p>
      </section>
    );
  }

  if (!permissions.view) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Limites e Planos</h2>
        <p>Você não possui permissão para visualizar limites desta organização.</p>
      </section>
    );
  }

  return (
    <section className="mm-card mm-section-card">
      <h2>Limites e Planos</h2>
      <p>
        Acompanhe o uso atual da organização e solicite upgrade de plano ou
        aumento de limites. Solicitações criam registros pendentes e não alteram
        o plano automaticamente.
      </p>

      {errorMessage && (
        <div className="mm-card" role="alert">
          <strong>Erro</strong>
          <p>{errorMessage}</p>

          <button
            type="button"
            className="mm-btn"
            onClick={() => {
              void loadLimits();
            }}
          >
            Recarregar
          </button>
        </div>
      )}

      {successMessage && (
        <div className="mm-card" role="status">
          <strong>Sucesso</strong>
          <p>{successMessage}</p>
        </div>
      )}

      {loading && (
        <div className="mm-card">
          <p>Carregando limites da organização...</p>
        </div>
      )}

      {!loading && (
        <>
          <div className="mm-card">
            <h3>Plano atual</h3>

            <div className="mm-tags-list">
              <span className={planClassName(limits?.plan)}>
                {planLabel(limits?.plan)}
              </span>

              <span className="mm-tag">Organização #{organizationId}</span>
            </div>

            <p>
              O plano atual só pode ser alterado por fluxo administrativo futuro.
              Nesta sprint, esta tela apenas cria solicitações pendentes.
            </p>
          </div>

          <div className="mm-card">
            <h3>Uso e limites</h3>

            <div className="mm-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th>Uso atual</th>
                    <th>Limite</th>
                    <th>Uso</th>
                  </tr>
                </thead>

                <tbody>
                  {limitItems.map((item) => (
                    <LimitUsageRow key={item.key} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mm-card">
            <h3>Solicitar upgrade ou aumento</h3>

            {permissions.increaseRequest ? (
              <form onSubmit={handleCreateRequest}>
                <div className="mm-form-grid">
                  <label>
                    Tipo
                    <select
                      value={form.requestType}
                      onChange={(event) =>
                        updateForm("requestType", event.target.value)
                      }
                    >
                      <option value="plan_upgrade">Upgrade de plano</option>
                      <option value="users_increase">Aumento de usuários</option>
                      <option value="projects_increase">
                        Aumento de projetos
                      </option>
                      <option value="storage_increase">
                        Aumento de armazenamento
                      </option>
                      <option value="exports_increase">
                        Aumento de exportações
                      </option>
                    </select>
                  </label>

                  <label>
                    Plano solicitado
                    <select
                      value={form.requestedPlan}
                      onChange={(event) =>
                        updateForm("requestedPlan", event.target.value)
                      }
                    >
                      {PLAN_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Motivo
                    <textarea
                      value={form.reason}
                      onChange={(event) =>
                        updateForm("reason", event.target.value)
                      }
                      placeholder="Explique a necessidade de aumento ou upgrade."
                      rows={3}
                    />
                  </label>
                </div>

                <div className="mm-actions-row">
                  <button
                    type="submit"
                    className="mm-btn primary"
                    disabled={busyKey === "create-request"}
                  >
                    {busyKey === "create-request"
                      ? "Enviando..."
                      : "Criar solicitação"}
                  </button>

                  <span className="mm-tag">Não altera plano diretamente</span>
                </div>
              </form>
            ) : (
              <p>
                Seu perfil não possui permissão visual para solicitar aumento de
                limite.
              </p>
            )}
          </div>

          <div className="mm-card">
            <h3>Solicitações pendentes</h3>
            <PendingRequestsTable requests={pendingRequests} />
          </div>

          <div className="mm-card">
            <strong>Permissões visuais nesta tela</strong>

            <div className="mm-tags-list">
              <span className={permissions.view ? "mm-tag green" : "mm-tag red"}>
                limits.view
              </span>

              <span
                className={
                  permissions.increaseRequest ? "mm-tag green" : "mm-tag red"
                }
              >
                limits.increase_request
              </span>
            </div>

            <p>
              Estes indicadores servem apenas para orientar a interface. O
              backend continua validando permissão, escopo e auditoria.
            </p>
          </div>
        </>
      )}
    </section>
  );
}