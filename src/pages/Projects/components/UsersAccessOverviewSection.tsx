import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getOrganizationLimits,
  listOrganizationUsers,
  type OrganizationLimits,
  type OrganizationUser,
} from "../../../lib/api";
import OrganizationPermissionManager, {
  loadAccessGovernance,
  type AccessGovernanceCapabilities,
} from "../../../components/access/OrganizationPermissionManager";
import {
  accessFromCode,
  profileFromTechnical,
} from "./user-access-commercial";

type ApiId = number | string;

type MaonoUser = {
  id?: ApiId;
  role?: string | null;
  permissions?: string[];
  activeOrganizationId?: ApiId | null;
  organizationId?: ApiId | null;
  organization_id?: ApiId | null;
  [key: string]: unknown;
};

function roleOf(user: MaonoUser | null): string {
  return String(user?.role || "viewer").trim().toLowerCase();
}

function userPermissions(user: MaonoUser | null): string[] {
  return Array.isArray(user?.permissions)
    ? user.permissions.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
}

function hasPermission(user: MaonoUser | null, permission: string): boolean {
  const role = roleOf(user);
  if (role === "super_admin") return true;
  if (
    (role === "owner" || role === "client") &&
    ["users.view", "limits.view"].includes(permission)
  ) {
    return true;
  }
  return userPermissions(user).includes(permission);
}

function canViewTeam(user: MaonoUser | null): boolean {
  const role = roleOf(user);
  return (
    ["super_admin", "admin", "owner", "client"].includes(role) ||
    hasPermission(user, "users.view")
  );
}

function fallbackOrganizationId(user: MaonoUser | null): ApiId | null {
  const value =
    user?.activeOrganizationId ??
    user?.organizationId ??
    user?.organization_id;
  return typeof value === "number" || (typeof value === "string" && value)
    ? value
    : null;
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação.";
}

function profileLabel(person: OrganizationUser): string {
  return (
    profileFromTechnical(person.role, person.accessLevel)?.shortName ??
    "Perfil personalizado"
  );
}

function targetLevel(person: OrganizationUser): string {
  return String(person.accessLevel || "").trim().toLowerCase();
}

function sameId(left?: ApiId, right?: ApiId): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    String(left) === String(right)
  );
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : new Intl.DateTimeFormat("pt-BR").format(date);
}

export default function UsersAccessOverviewSection({
  user,
  organizationId: organizationIdProp,
}: {
  user: MaonoUser | null;
  organizationId?: ApiId | null;
}) {
  const organizationId =
    organizationIdProp ?? fallbackOrganizationId(user);
  const [people, setPeople] = useState<OrganizationUser[]>([]);
  const [limits, setLimits] = useState<OrganizationLimits | null>(null);
  const [governance, setGovernance] =
    useState<AccessGovernanceCapabilities | null>(null);
  const [managementTargetUserId, setManagementTargetUserId] =
    useState<ApiId | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [profileFilter, setProfileFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);

  const canView = canViewTeam(user);
  const isSuperAdmin = roleOf(user) === "super_admin";

  const load = useCallback(async () => {
    if (!organizationId || !canView) return;
    setLoading(true);
    setMessage(null);
    try {
      let governanceError = "";
      const [peopleResult, limitResult, governanceResult] = await Promise.all([
        listOrganizationUsers(organizationId),
        hasPermission(user, "limits.view")
          ? getOrganizationLimits(organizationId).catch(() => null)
          : Promise.resolve(null),
        loadAccessGovernance(organizationId).catch((error) => {
          governanceError = errorText(error);
          return null;
        }),
      ]);
      setPeople(peopleResult.users ?? []);
      setLimits(limitResult?.limits ?? null);
      setGovernance(governanceResult);
      if (governanceError) {
        setMessage({
          kind: "error",
          text:
            "A equipe está disponível somente para consulta. " +
            governanceError,
        });
      }
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setLoading(false);
    }
  }, [canView, organizationId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const delegatedAlternative = Boolean(
    governance?.mode === "organization" &&
      governance.canManageAdditionalAccesses,
  );

  const canManagePerson = useCallback(
    (person: OrganizationUser) =>
      delegatedAlternative &&
      person.active !== false &&
      !sameId(person.id, user?.id) &&
      Boolean(governance?.allowedTargetLevels.includes(targetLevel(person))),
    [delegatedAlternative, governance, user?.id],
  );

  const active = people.filter((item) => item.active !== false).length;
  const suspended = people.length - active;
  const limit = limits?.users.limit ?? Math.max(active, people.length);
  const available = Math.max(0, limit - active);
  const percent =
    limit > 0 ? Math.min(100, Math.round((active / limit) * 100)) : 0;

  const filtered = useMemo(
    () =>
      people.filter((person) => {
        const text = (
          (person.name || "") +
          " " +
          (person.email || "") +
          " " +
          profileLabel(person) +
          " " +
          (person.permissions ?? [])
            .map((code) => accessFromCode(code).name)
            .join(" ")
        ).toLowerCase();
        if (query && !text.includes(query.toLowerCase())) return false;
        if (status === "active" && person.active === false) return false;
        if (status === "suspended" && person.active !== false) return false;
        if (
          profileFilter !== "all" &&
          profileLabel(person) !== profileFilter
        ) {
          return false;
        }
        return true;
      }),
    [people, profileFilter, query, status],
  );

  if (!organizationId) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Usuários e Acessos</h2>
        <p>Não foi possível identificar a organização ativa.</p>
      </section>
    );
  }

  if (!canView) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Usuários e Acessos</h2>
        <p>Você não possui acesso para consultar a equipe.</p>
      </section>
    );
  }

  return (
    <section className="people-access-section">
      <header className="people-access-header">
        <div>
          <span className="people-eyebrow">VISÃO DA EQUIPE</span>
          <h2>Usuários e Acessos</h2>
          <p>
            Consulte pessoas, perfis e acessos da organização. O Super Admin
            configura políticas no Painel Admin; delegados atuam nesta lista.
          </p>
        </div>
        <div className="people-access-actions">
          {isSuperAdmin && (
            <a
              className="mm-btn primary"
              href={
                "/admin?section=users&organization=" +
                encodeURIComponent(String(organizationId))
              }
            >
              Gerenciar no Painel Admin
            </a>
          )}
        </div>
      </header>

      {delegatedAlternative ? (
        <div className="people-notice governance active" role="status">
          <strong>Delegação limitada ativa</strong>
          <span>
            Use o botão <strong>Gerenciar</strong> na linha de cada pessoa
            elegível. O painel respeita a organização ativa, os perfis
            permitidos e a whitelist definida pelo Super Admin.
          </span>
        </div>
      ) : (
        <div className="people-notice governance" role="status">
          <strong>Consulta operacional</strong>
          <span>
            Esta tela não altera perfis, vínculos ou acessos adicionais.
          </span>
        </div>
      )}

      <div className="people-capacity-grid">
        <article>
          <span>Pessoas com acesso</span>
          <strong>{active}</strong>
        </article>
        <article>
          <span>Limite da organização</span>
          <strong>{limit}</strong>
        </article>
        <article>
          <span>Vagas disponíveis</span>
          <strong>{available}</strong>
        </article>
        <article>
          <span>Acessos suspensos</span>
          <strong>{suspended}</strong>
        </article>
      </div>

      <div className="people-capacity-progress">
        <div>
          <span>
            {active} de {limit} acessos utilizados
          </span>
          <strong>{percent}%</strong>
        </div>
        <progress max="100" value={percent}>
          {percent}%
        </progress>
      </div>

      {message && (
        <div
          className={"people-notice " + message.kind}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </div>
      )}

      <div className="people-toolbar">
        <label>
          <span>Buscar</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome, e-mail ou acesso"
          />
        </label>
        <label>
          <span>Situação</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">Todas</option>
            <option value="active">Ativo</option>
            <option value="suspended">Suspenso</option>
          </select>
        </label>
        <label>
          <span>Perfil</span>
          <select
            value={profileFilter}
            onChange={(event) => setProfileFilter(event.target.value)}
          >
            <option value="all">Todos os perfis</option>
            {Array.from(new Set(people.map(profileLabel))).map((label) => (
              <option key={label}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="people-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Situação</th>
              <th>Perfil</th>
              <th>Acessos adicionais</th>
              <th>Atualizado em</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6}>Carregando pessoas com acesso...</td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={6}>Nenhuma pessoa encontrada.</td>
              </tr>
            )}
            {!loading &&
              filtered.map((person) => (
                <tr key={String(person.id)}>
                  <td>
                    <strong>{person.name || "Pessoa sem nome"}</strong>
                    <small>{person.email}</small>
                  </td>
                  <td>
                    <span
                      className={
                        "people-status " +
                        (person.active === false ? "suspended" : "active")
                      }
                    >
                      {person.active === false ? "Suspenso" : "Ativo"}
                    </span>
                  </td>
                  <td>{profileLabel(person)}</td>
                  <td>
                    {(person.permissions ?? []).length
                      ? String(person.permissions?.length) +
                        " acesso" +
                        (person.permissions?.length === 1 ? "" : "s")
                      : "Nenhum adicional"}
                  </td>
                  <td>{formatDate(person.updatedAt ?? person.createdAt)}</td>
                  <td>
                    {canManagePerson(person) ? (
                      <button
                        className="mm-btn tiny people-manage-button"
                        type="button"
                        onClick={() => setManagementTargetUserId(person.id)}
                      >
                        Gerenciar
                      </button>
                    ) : (
                      <span className="people-action-unavailable">—</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {managementTargetUserId !== null && delegatedAlternative && (
        <OrganizationPermissionManager
          organizationId={organizationId}
          actorUserId={user?.id}
          initialTargetUserId={managementTargetUserId}
          mode="delegated"
          onClose={() => setManagementTargetUserId(null)}
          onSaved={load}
        />
      )}
    </section>
  );
}
