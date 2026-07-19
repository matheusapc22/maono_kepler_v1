import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  createOrganizationUser,
  deleteOrganizationUserMembership,
  getOrganizationLimits,
  grantOrganizationUserPermission,
  listOrganizationUsers,
  revokeOrganizationUserPermission,
  updateOrganizationUser,
  type OrganizationLimits,
  type OrganizationUser,
} from "../../../lib/api";
import {
  COMMERCIAL_ACCESSES,
  COMMERCIAL_PROFILES,
  accessFromCode,
  profileFromTechnical,
  riskLabel,
  type CommercialProfileId,
} from "./user-access-commercial";

type ApiId = number | string;
type MaonoUser = {
  role?: string | null;
  permissions?: string[];
  activeOrganizationId?: ApiId | null;
  organizationId?: ApiId | null;
  organization_id?: ApiId | null;
  [key: string]: unknown;
};

type DelegationSummary = {
  enabled?: boolean;
  expired?: boolean;
  expiresAt?: string | null;
  version?: number;
};

type AccessGovernanceCapabilities = {
  mode: "super_admin" | "organization";
  organizationId: ApiId;
  canManageAdditionalAccesses: boolean;
  canGrant: boolean;
  canRevoke: boolean;
  allowedPermissions: string[];
  grantPermissions: string[];
  revokePermissions: string[];
  allowedTargetLevels: string[];
  delegation?: DelegationSummary | null;
  reason: string;
};

type EditorState = {
  person: OrganizationUser;
  name: string;
  profile: CommercialProfileId;
  active: boolean;
  accesses: string[];
  geoJsonAcknowledged: boolean;
  geoJsonJustification: string;
  password: string;
};

type CreateState = {
  name: string;
  email: string;
  profile: CommercialProfileId;
  active: boolean;
  accesses: string[];
};

const EMPTY_CREATE: CreateState = {
  name: "",
  email: "",
  profile: "consultation",
  active: true,
  accesses: [],
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function fallbackOrganizationId(user: MaonoUser | null): ApiId | null {
  const data = object(user);
  const value =
    data.activeOrganizationId ?? data.organizationId ?? data.organization_id;
  return typeof value === "number" || (typeof value === "string" && value)
    ? value
    : null;
}

function roleOf(user: MaonoUser | null): string {
  return String(object(user).role || "viewer").toLowerCase();
}

function userPermissions(user: MaonoUser | null): string[] {
  const value = object(user).permissions;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function can(user: MaonoUser | null, permission: string): boolean {
  const role = roleOf(user);
  if (role === "super_admin" || role === "admin") return true;
  if (
    (role === "owner" || role === "client") &&
    [
      "users.view",
      "users.create",
      "users.edit",
      "users.disable",
      "role.assign",
      "limits.view",
    ].includes(permission)
  ) {
    return true;
  }
  return userPermissions(user).includes(permission);
}

function profileOptions(user: MaonoUser | null) {
  const role = roleOf(user);
  if (role === "super_admin") return COMMERCIAL_PROFILES;
  if (role === "admin") {
    return COMMERCIAL_PROFILES.filter((item) => !item.platformOnly);
  }
  if (role === "owner" || role === "client") {
    return COMMERCIAL_PROFILES.filter(
      (item) => item.id === "collaborator" || item.id === "consultation",
    );
  }
  return COMMERCIAL_PROFILES.filter((item) => item.id === "consultation");
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação.";
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : new Intl.DateTimeFormat("pt-BR").format(date);
}

function profileLabel(person: OrganizationUser): string {
  return (
    profileFromTechnical(person.role, person.accessLevel)?.shortName ??
    "Perfil personalizado"
  );
}

function summarize(profileId: CommercialProfileId, accesses: string[]): string {
  const profile = COMMERCIAL_PROFILES.find((item) => item.id === profileId);
  const names = accesses
    .slice(0, 3)
    .map((code) => accessFromCode(code).name.toLowerCase());
  const extra = names.length
    ? `, com acessos adicionais para ${names.join(", ")}`
    : "";
  return `${profile?.name ?? "Esta pessoa"} poderá ${
    profile?.summary ?? "usar os acessos configurados"
  }${extra}.`;
}

async function loadAccessGovernance(
  organizationId: ApiId,
): Promise<AccessGovernanceCapabilities> {
  const response = await fetch(
    `/api/organizations/${encodeURIComponent(
      String(organizationId),
    )}/access-governance`,
    { credentials: "include", headers: { Accept: "application/json" } },
  );
  const data = await response.json();
  if (!response.ok || data?.ok === false || !data?.capabilities) {
    throw new Error(data?.error || "Não foi possível carregar a governança de acessos.");
  }
  return data.capabilities as AccessGovernanceCapabilities;
}

function AccessChecklist({
  selected,
  onChange,
  options,
  grantPermissions,
  revokePermissions,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  options: typeof COMMERCIAL_ACCESSES;
  grantPermissions: Set<string>;
  revokePermissions: Set<string>;
}) {
  const groups = Array.from(new Set(options.map((item) => item.group)));
  return (
    <div className="people-access-groups">
      {groups.map((group) => (
        <fieldset key={group} className="people-access-group">
          <legend>{group}</legend>
          {options
            .filter((item) => item.group === group)
            .map((item) => {
              const checked = selected.includes(item.code);
              const canChange = checked
                ? revokePermissions.has(item.code)
                : grantPermissions.has(item.code);
              const alert = riskLabel(item.risk);
              return (
                <label
                  key={item.code}
                  className={`people-access-option${
                    canChange ? "" : " disabled"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!canChange}
                    onChange={() =>
                      onChange(
                        checked
                          ? selected.filter((code) => code !== item.code)
                          : [...selected, item.code],
                      )
                    }
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.description}</small>
                    {!canChange && (
                      <em className="people-risk platform">
                        Fora da operação delegada
                      </em>
                    )}
                    {canChange && alert && (
                      <em className={`people-risk ${item.risk}`}>{alert}</em>
                    )}
                  </span>
                </label>
              );
            })}
        </fieldset>
      ))}
    </div>
  );
}

export default function UsersAccessSection({
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
  const [createOpen, setCreateOpen] = useState(false);
  const [create, setCreate] = useState<CreateState>(EMPTY_CREATE);
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [profileFilter, setProfileFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);

  const permissions = useMemo(
    () => ({
      view: can(user, "users.view"),
      create: can(user, "users.create"),
      edit: can(user, "users.edit"),
      disable: can(user, "users.disable"),
      assign: can(user, "role.assign"),
      limits: can(user, "limits.view"),
    }),
    [user],
  );
  const profiles = useMemo(() => profileOptions(user), [user]);
  const grantPermissions = useMemo(
    () => new Set(governance?.grantPermissions ?? []),
    [governance],
  );
  const revokePermissions = useMemo(
    () => new Set(governance?.revokePermissions ?? []),
    [governance],
  );
  const allowedPermissions = useMemo(
    () => new Set(governance?.allowedPermissions ?? []),
    [governance],
  );
  const accesses = useMemo(
    () =>
      COMMERCIAL_ACCESSES.filter((item) =>
        allowedPermissions.has(item.code),
      ),
    [allowedPermissions],
  );

  const load = useCallback(async () => {
    if (!organizationId || !permissions.view) return;
    setLoading(true);
    setMessage(null);
    try {
      const [peopleResult, limitResult, governanceResult] = await Promise.all([
        listOrganizationUsers(organizationId),
        permissions.limits
          ? getOrganizationLimits(organizationId).catch(() => null)
          : Promise.resolve(null),
        loadAccessGovernance(organizationId),
      ]);
      setPeople(peopleResult.users ?? []);
      setLimits(limitResult?.limits ?? null);
      setGovernance(governanceResult);
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setLoading(false);
    }
  }, [organizationId, permissions.limits, permissions.view]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = people.filter((item) => item.active !== false).length;
  const suspended = people.length - active;
  const limit = limits?.users.limit ?? Math.max(active, people.length);
  const available = Math.max(0, limit - active);
  const percent =
    limit > 0 ? Math.min(100, Math.round((active / limit) * 100)) : 0;
  const filtered = people.filter((item) => {
    const text = `${item.name ?? ""} ${item.email ?? ""} ${profileLabel(
      item,
    )} ${(item.permissions ?? [])
      .map((code) => accessFromCode(code).name)
      .join(" ")}`.toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (status === "active" && item.active === false) return false;
    if (status === "suspended" && item.active !== false) return false;
    if (profileFilter !== "all" && profileLabel(item) !== profileFilter) {
      return false;
    }
    return true;
  });

  function targetLevelForProfile(profileId: CommercialProfileId) {
    return COMMERCIAL_PROFILES.find((item) => item.id === profileId)
      ?.accessLevel;
  }

  function canManageTarget(profileId: CommercialProfileId) {
    const targetLevel = targetLevelForProfile(profileId);
    return Boolean(
      governance?.canManageAdditionalAccesses &&
        targetLevel &&
        governance.allowedTargetLevels.includes(targetLevel),
    );
  }

  async function createPerson(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || !permissions.create) return;
    const profile = COMMERCIAL_PROFILES.find(
      (item) => item.id === create.profile,
    );
    if (!profile || !create.name.trim() || !create.email.trim()) {
      setMessage({
        kind: "error",
        text: "Preencha nome, e-mail e perfil de participação.",
      });
      return;
    }
    if (create.active && available <= 0) {
      setMessage({
        kind: "error",
        text: "Não há vagas disponíveis para um novo acesso ativo.",
      });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const result = await createOrganizationUser(organizationId, {
        name: create.name.trim(),
        email: create.email.trim(),
        role: profile.role,
        accessLevel: profile.accessLevel,
        active: create.active,
      });
      if (canManageTarget(create.profile)) {
        for (const code of create.accesses.filter((item) =>
          grantPermissions.has(item),
        )) {
          await grantOrganizationUserPermission(
            organizationId,
            result.user.id,
            code,
          );
        }
      }
      setCreate(EMPTY_CREATE);
      setCreateOpen(false);
      setMessage({ kind: "success", text: "Pessoa adicionada com sucesso." });
      await load();
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  function openEditor(person: OrganizationUser) {
    setEditing({
      person,
      name: person.name ?? "",
      profile:
        profileFromTechnical(person.role, person.accessLevel)?.id ?? "custom",
      active: person.active !== false,
      accesses: [...(person.permissions ?? [])],
      geoJsonAcknowledged: false,
      geoJsonJustification: "",
      password: "",
    });
  }

  async function savePerson(event: FormEvent) {
    event.preventDefault();
    if (!editing || !organizationId) return;
    const profile = COMMERCIAL_PROFILES.find(
      (item) => item.id === editing.profile,
    );
    const geoJsonCode = "organization.projects.geojson.view";
    const grantsBroadGeoJson =
      editing.accesses.includes(geoJsonCode) &&
      !(editing.person.permissions ?? []).includes(geoJsonCode);
    const targetRole = String(editing.person.role || "viewer").toLowerCase();
    if (
      grantsBroadGeoJson &&
      (targetRole === "viewer" || targetRole === "editor") &&
      (!editing.geoJsonAcknowledged ||
        !editing.geoJsonJustification.trim())
    ) {
      setMessage({
        kind: "error",
        text: "Confirme a ciência e informe uma justificativa para liberar GeoJSON amplo a este perfil.",
      });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const payload: {
        name?: string;
        active?: boolean;
        role?: string;
        accessLevel?: string;
        password?: string;
      } = {};
      if (
        permissions.edit &&
        editing.name.trim() !== (editing.person.name ?? "")
      ) {
        payload.name = editing.name.trim();
      }
      if (permissions.assign && profile) {
        payload.role = profile.role;
        payload.accessLevel = profile.accessLevel;
      }
      if (editing.active !== (editing.person.active !== false)) {
        payload.active = editing.active;
      }
      if (roleOf(user) === "super_admin" && editing.password) {
        payload.password = editing.password;
      }
      if (Object.keys(payload).length) {
        await updateOrganizationUser(
          organizationId,
          editing.person.id,
          payload,
        );
      }

      if (canManageTarget(editing.profile)) {
        const before = editing.person.permissions ?? [];
        for (const code of editing.accesses.filter(
          (item) => !before.includes(item) && grantPermissions.has(item),
        )) {
          await grantOrganizationUserPermission(
            organizationId,
            editing.person.id,
            code,
            code === geoJsonCode
              ? {
                  warningAcknowledged: editing.geoJsonAcknowledged,
                  justification: editing.geoJsonJustification.trim(),
                }
              : undefined,
          );
        }
        for (const code of before.filter(
          (item) =>
            !editing.accesses.includes(item) && revokePermissions.has(item),
        )) {
          await revokeOrganizationUserPermission(
            organizationId,
            editing.person.id,
            code,
          );
        }
      }

      setEditing(null);
      setMessage({
        kind: "success",
        text: "Acesso atualizado com sucesso.",
      });
      await load();
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function removePerson() {
    if (
      !editing ||
      !organizationId ||
      !window.confirm(
        `Remover ${
          editing.person.name || editing.person.email
        } desta organização?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await deleteOrganizationUserMembership(
        organizationId,
        editing.person.id,
      );
      setEditing(null);
      setMessage({
        kind: "success",
        text: "Acesso removido da organização.",
      });
      await load();
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  if (!organizationId) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Usuários e Acessos</h2>
        <p>Não foi possível identificar a organização ativa.</p>
      </section>
    );
  }
  if (!permissions.view) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Usuários e Acessos</h2>
        <p>Você não possui acesso para consultar a equipe.</p>
      </section>
    );
  }

  const delegatedRole = ["admin", "owner", "client"].includes(roleOf(user));
  const governanceBlocked =
    delegatedRole && !governance?.canManageAdditionalAccesses;

  return (
    <section className="people-access-section">
      <header className="people-access-header">
        <div>
          <span className="people-eyebrow">GESTÃO POR ORGANIZAÇÃO</span>
          <h2>Usuários e Acessos</h2>
          <p>
            Consulte a equipe e, quando houver delegação ativa, atribua acessos
            adicionais dentro dos limites definidos pelo Super Admin.
          </p>
        </div>
        {permissions.create && (
          <button
            className="mm-btn primary"
            type="button"
            onClick={() => setCreateOpen(true)}
          >
            ＋ Adicionar pessoa
          </button>
        )}
      </header>

      {governanceBlocked && (
        <div className="people-notice governance" role="status">
          <strong>Gestão de acessos adicionais não delegada</strong>
          <span>
            Você pode consultar a equipe, mas só poderá conceder ou revogar
            acessos adicionais quando o Super Admin ativar uma política para
            esta organização.
          </span>
        </div>
      )}
      {governance?.canManageAdditionalAccesses &&
        governance.mode === "organization" && (
          <div className="people-notice governance active" role="status">
            <strong>Delegação limitada ativa</strong>
            <span>
              A gestão abaixo está restrita à organização ativa, aos perfis
              autorizados e à whitelist configurada pelo Super Admin.
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
          className={`people-notice ${message.kind}`}
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
                <tr key={person.id}>
                  <td>
                    <strong>{person.name || "Pessoa sem nome"}</strong>
                    <small>{person.email}</small>
                  </td>
                  <td>
                    <span
                      className={`people-status ${
                        person.active === false ? "suspended" : "active"
                      }`}
                    >
                      {person.active === false ? "Suspenso" : "Ativo"}
                    </span>
                  </td>
                  <td>{profileLabel(person)}</td>
                  <td>
                    {(person.permissions ?? []).length
                      ? `${person.permissions?.length} acesso${
                          person.permissions?.length === 1 ? "" : "s"
                        }`
                      : "Nenhum adicional"}
                  </td>
                  <td>{formatDate(person.updatedAt ?? person.createdAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="people-edit-button"
                      onClick={() => openEditor(person)}
                      aria-label={`Editar acesso de ${
                        person.name || person.email
                      }`}
                    >
                      ✎
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {(createOpen || editing) && (
        <div
          className="people-drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setCreateOpen(false);
              setEditing(null);
            }
          }}
        >
          <aside
            className="people-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="people-drawer-title"
          >
            <header>
              <div>
                <span className="people-eyebrow">
                  {editing ? "GESTÃO DE ACESSO" : "NOVO ACESSO"}
                </span>
                <h3 id="people-drawer-title">
                  {editing ? "Editar acesso" : "Novo acesso à organização"}
                </h3>
                <p>
                  {editing
                    ? "Revise o perfil, a situação e os acessos desta pessoa."
                    : "Escolha um perfil de participação e, se autorizado, libere acessos adicionais."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(false);
                  setEditing(null);
                }}
                aria-label="Fechar"
              >
                ×
              </button>
            </header>

            {!editing ? (
              <form onSubmit={createPerson} className="people-drawer-form">
                <div className="people-form-grid">
                  <label>
                    Nome completo
                    <input
                      value={create.name}
                      onChange={(event) =>
                        setCreate({ ...create, name: event.target.value })
                      }
                      required
                    />
                  </label>
                  <label>
                    E-mail de acesso
                    <input
                      type="email"
                      value={create.email}
                      onChange={(event) =>
                        setCreate({ ...create, email: event.target.value })
                      }
                      required
                    />
                  </label>
                  <label>
                    Perfil de participação
                    <select
                      value={create.profile}
                      onChange={(event) => {
                        const profile = event.target
                          .value as CommercialProfileId;
                        setCreate({
                          ...create,
                          profile,
                          accesses: canManageTarget(profile)
                            ? create.accesses
                            : [],
                        });
                      }}
                    >
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Situação inicial
                    <select
                      value={create.active ? "active" : "suspended"}
                      onChange={(event) =>
                        setCreate({
                          ...create,
                          active: event.target.value === "active",
                        })
                      }
                    >
                      <option value="active">Ativo</option>
                      <option value="suspended">Suspenso</option>
                    </select>
                  </label>
                </div>
                <div className="people-profile-description">
                  {
                    COMMERCIAL_PROFILES.find(
                      (item) => item.id === create.profile,
                    )?.description
                  }
                  <strong>
                    {available} vaga{available === 1 ? "" : "s"} disponível
                    {available === 1 ? "" : "is"}
                  </strong>
                </div>
                {canManageTarget(create.profile) && accesses.length > 0 && (
                  <>
                    <h4>Acessos adicionais delegados</h4>
                    <AccessChecklist
                      selected={create.accesses}
                      onChange={(next) =>
                        setCreate({ ...create, accesses: next })
                      }
                      options={accesses}
                      grantPermissions={grantPermissions}
                      revokePermissions={revokePermissions}
                    />
                  </>
                )}
                <div className="people-summary">
                  <strong>Resumo</strong>
                  <p>{summarize(create.profile, create.accesses)}</p>
                </div>
                <footer>
                  <button
                    type="button"
                    className="mm-btn"
                    onClick={() => setCreateOpen(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="mm-btn primary"
                    disabled={busy}
                  >
                    {busy ? "Adicionando..." : "Adicionar pessoa"}
                  </button>
                </footer>
              </form>
            ) : (
              <form onSubmit={savePerson} className="people-drawer-form">
                <div className="people-form-grid">
                  <label>
                    Nome completo
                    <input
                      value={editing.name}
                      disabled={!permissions.edit}
                      onChange={(event) =>
                        setEditing({ ...editing, name: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    E-mail de acesso
                    <input value={editing.person.email ?? ""} disabled />
                  </label>
                  <label>
                    Perfil de participação
                    <select
                      value={editing.profile}
                      disabled={!permissions.assign}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          profile: event.target.value as CommercialProfileId,
                        })
                      }
                    >
                      <option value="custom">Perfil personalizado</option>
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Situação do acesso
                    <select
                      value={editing.active ? "active" : "suspended"}
                      disabled={!permissions.edit && !permissions.disable}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          active: event.target.value === "active",
                        })
                      }
                    >
                      <option value="active">Ativo</option>
                      <option value="suspended">Suspenso</option>
                    </select>
                  </label>
                  {roleOf(user) === "super_admin" && (
                    <label>
                      Definir nova senha
                      <input
                        type="password"
                        value={editing.password}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            password: event.target.value,
                          })
                        }
                        minLength={8}
                        placeholder="Deixe vazio para manter"
                        autoComplete="new-password"
                      />
                    </label>
                  )}
                </div>

                {canManageTarget(editing.profile) && accesses.length > 0 && (
                  <>
                    <h4>O que esta pessoa pode fazer?</h4>
                    <AccessChecklist
                      selected={editing.accesses}
                      onChange={(next) =>
                        setEditing({ ...editing, accesses: next })
                      }
                      options={accesses}
                      grantPermissions={grantPermissions}
                      revokePermissions={revokePermissions}
                    />
                    {editing.accesses.includes(
                      "organization.projects.geojson.view",
                    ) &&
                      ["viewer", "editor"].includes(
                        String(
                          editing.person.role || "viewer",
                        ).toLowerCase(),
                      ) && (
                        <div
                          className="people-geojson-warning"
                          role="alert"
                        >
                          <strong>Acesso amplo a GeoJSON</strong>
                          <p>
                            Esta pessoa poderá visualizar os dados GeoJSON de
                            todos os projetos ativos desta organização,
                            inclusive os não atribuídos individualmente.
                          </p>
                          <label>
                            <input
                              type="checkbox"
                              checked={editing.geoJsonAcknowledged}
                              onChange={(event) =>
                                setEditing({
                                  ...editing,
                                  geoJsonAcknowledged: event.target.checked,
                                })
                              }
                            />
                            Estou ciente do alcance deste acesso.
                          </label>
                          <label>
                            Justificativa obrigatória
                            <textarea
                              value={editing.geoJsonJustification}
                              onChange={(event) =>
                                setEditing({
                                  ...editing,
                                  geoJsonJustification: event.target.value,
                                })
                              }
                              maxLength={500}
                            />
                          </label>
                        </div>
                      )}
                  </>
                )}

                <div className="people-summary">
                  <strong>Resumo das mudanças</strong>
                  <p>{summarize(editing.profile, editing.accesses)}</p>
                </div>
                <footer>
                  {roleOf(user) === "super_admin" && (
                    <button
                      type="button"
                      className="mm-btn danger"
                      onClick={() => void removePerson()}
                      disabled={busy}
                    >
                      Remover da organização
                    </button>
                  )}
                  <button
                    type="button"
                    className="mm-btn"
                    onClick={() => setEditing(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="mm-btn primary"
                    disabled={busy}
                  >
                    {busy ? "Salvando..." : "Salvar alterações"}
                  </button>
                </footer>
              </form>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
