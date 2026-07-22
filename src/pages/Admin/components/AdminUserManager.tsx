import { useEffect, useMemo, useState, type FormEvent } from "react";

import OrganizationPermissionManager from "../../../components/access/OrganizationPermissionManager";

type User = {
  id: number;
  name?: string;
  email: string;
  role: string;
  active?: boolean;
  projectCount?: number;
  organizations?: Array<{
    id: number;
    name: string;
    slug: string;
    accessLevel: string;
    active?: boolean;
  }>;
};

type Organization = {
  id: number;
  name: string;
  slug: string;
  active?: boolean;
};

type Membership = Organization & {
  assigned: boolean;
  accessLevel: string;
};

type Draft = {
  name: string;
  email: string;
  role: string;
  active: boolean;
  password: string;
};

type DelegationCatalogItem = {
  code: string;
  group: string;
  name: string;
  risk?: string;
};

type DelegationPermission = {
  permission: string;
  canGrant: boolean;
  canRevoke: boolean;
};

type DelegationPermissionDraft = {
  enabled: boolean;
  canGrant: boolean;
  canRevoke: boolean;
};

type DelegationEditor = {
  organization: Membership;
  catalog: DelegationCatalogItem[];
  version: number | null;
  enabled: boolean;
  expiresAt: string;
  targetLevels: string[];
  permissions: Record<string, DelegationPermissionDraft>;
};

type UserManagementView =
  | "profile"
  | "organizations"
  | "features"
  | "delegation";

async function json(response: Response) {
  const data = await response.json();
  if (!response.ok || data?.ok === false) {
    throw new Error(
      data?.error?.message || data?.error || "Erro na requisição.",
    );
  }
  return data;
}

const headers = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

function role(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toDateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function AdminUserManager({
  users,
  organizations,
  initialOrganizationId,
  currentUserId,
  isSuperAdmin,
  onRefresh,
  onMessage,
}: {
  users: User[];
  organizations: Organization[];
  initialOrganizationId?: number | string | null;
  currentUserId?: number;
  isSuperAdmin: boolean;
  onRefresh: () => Promise<void>;
  onMessage: (kind: "error" | "success", text: string) => void;
}) {
  const [selected, setSelected] = useState<User | null>(null);
  const [selectedView, setSelectedView] =
    useState<UserManagementView>("profile");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [busy, setBusy] = useState(false);
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [organizationFilter, setOrganizationFilter] = useState(
    initialOrganizationId === null || initialOrganizationId === undefined
      ? "all"
      : String(initialOrganizationId),
  );
  const [profileFilter, setProfileFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [delegationEditor, setDelegationEditor] =
    useState<DelegationEditor | null>(null);
  const [accessEditor, setAccessEditor] = useState<{
    organization: Membership;
    targetUserId: number;
  } | null>(null);

  useEffect(() => {
    if (initialOrganizationId !== null && initialOrganizationId !== undefined) {
      setOrganizationFilter(String(initialOrganizationId));
    }
  }, [initialOrganizationId]);

  useEffect(() => {
    if (!selected) {
      setDraft(null);
      setMemberships([]);
      setDelegationEditor(null);
      setAccessEditor(null);
      setMembershipsLoading(false);
      return;
    }

    setDraft({
      name: selected.name || "",
      email: selected.email,
      role: selected.role,
      active: selected.active !== false,
      password: "",
    });

    if (!isSuperAdmin) return;

    let cancelled = false;
    setMembershipsLoading(true);
    fetch(`/api/admin/users/${selected.id}/organizations`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then(json)
      .then((data) => {
        if (!cancelled) setMemberships(data.organizations || []);
      })
      .catch((error) => {
        if (!cancelled) onMessage("error", error.message);
      })
      .finally(() => {
        if (!cancelled) setMembershipsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected, isSuperAdmin, onMessage]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected || !draft) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/users/${selected.id}`, {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify({
          ...draft,
          password: draft.password || undefined,
        }),
      }).then(json);
      onMessage(
        "success",
        "Usuário atualizado. Sessões foram encerradas caso a senha tenha mudado.",
      );
      setSelected(null);
      await onRefresh();
    } catch (error) {
      onMessage(
        "error",
        error instanceof Error ? error.message : "Falha ao atualizar.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !selected ||
      !confirm(
        `Excluir definitivamente ${selected.email}? Esta ação remove sessões e vínculos.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await fetch(`/api/admin/users/${selected.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { Accept: "application/json" },
      }).then(json);
      onMessage("success", "Usuário excluído.");
      setSelected(null);
      await onRefresh();
    } catch (error) {
      onMessage(
        "error",
        error instanceof Error ? error.message : "Falha ao excluir.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await fetch("/api/admin/users", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          role: form.get("role"),
          password: form.get("password"),
          active: true,
        }),
      }).then(json);
      onMessage("success", "Usuário criado com senha inicial protegida.");
      setCreating(false);
      await onRefresh();
    } catch (error) {
      onMessage(
        "error",
        error instanceof Error ? error.message : "Falha ao criar.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateMembership(
    organization: Membership,
    assigned: boolean,
    accessLevel = organization.accessLevel,
  ) {
    if (!selected) return;
    setBusy(true);
    try {
      await fetch(
        `/api/admin/users/${selected.id}/organizations/${organization.id}`,
        {
          method: assigned ? "PUT" : "DELETE",
          credentials: "include",
          headers,
          body: assigned ? JSON.stringify({ accessLevel }) : undefined,
        },
      ).then(json);
      setMemberships((items) =>
        items.map((item) =>
          item.id === organization.id
            ? { ...item, assigned, accessLevel }
            : item,
        ),
      );
      if (!assigned && delegationEditor?.organization.id === organization.id) {
        setDelegationEditor(null);
      }
      if (!assigned && accessEditor?.organization.id === organization.id) {
        setAccessEditor(null);
      }
      onMessage(
        "success",
        assigned ? "Organização atribuída." : "Organização removida.",
      );
      await onRefresh();
    } catch (error) {
      onMessage(
        "error",
        error instanceof Error ? error.message : "Falha no vínculo.",
      );
    } finally {
      setBusy(false);
    }
  }

  function isEligibleForDelegation(organization: Membership) {
    if (!selected || !organization.assigned || selected.active === false) {
      return false;
    }
    return (
      role(selected.role) === "admin" ||
      role(organization.accessLevel) === "owner"
    );
  }

  async function openDelegation(organization: Membership) {
    if (!selected || !isEligibleForDelegation(organization)) return;
    setBusy(true);
    try {
      const data = await fetch(
        `/api/admin/organizations/${organization.id}/access-delegations/${selected.id}`,
        {
          credentials: "include",
          headers: { Accept: "application/json" },
        },
      ).then(json);
      const existing = data.delegation;
      const selectedPermissions = new Map<string, DelegationPermission>(
        (existing?.permissions || []).map(
          (item: DelegationPermission) => [item.permission, item] as const,
        ),
      );
      const permissionDraft: Record<string, DelegationPermissionDraft> = {};
      for (const item of data.catalog || []) {
        const configured = selectedPermissions.get(item.code);
        permissionDraft[item.code] = {
          enabled: Boolean(configured),
          canGrant: configured?.canGrant ?? true,
          canRevoke: configured?.canRevoke ?? true,
        };
      }
      setDelegationEditor({
        organization,
        catalog: data.catalog || [],
        version: existing?.version ?? null,
        enabled: Boolean(existing?.enabled && !existing?.expired),
        expiresAt: toDateTimeLocal(existing?.expiresAt),
        targetLevels:
          existing?.targetLevels?.length > 0
            ? existing.targetLevels
            : ["viewer", "editor"],
        permissions: permissionDraft,
      });
    } catch (error) {
      onMessage(
        "error",
        error instanceof Error
          ? error.message
          : "Falha ao carregar a política de delegação.",
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleTargetLevel(level: string) {
    if (!delegationEditor) return;
    const active = delegationEditor.targetLevels.includes(level);
    setDelegationEditor({
      ...delegationEditor,
      targetLevels: active
        ? delegationEditor.targetLevels.filter((item) => item !== level)
        : [...delegationEditor.targetLevels, level],
    });
  }

  function updateDelegationPermission(
    code: string,
    patch: Partial<DelegationPermissionDraft>,
  ) {
    if (!delegationEditor) return;
    const current = delegationEditor.permissions[code] || {
      enabled: false,
      canGrant: true,
      canRevoke: true,
    };
    const next = { ...current, ...patch };
    if (!next.enabled) {
      next.canGrant = true;
      next.canRevoke = true;
    }
    setDelegationEditor({
      ...delegationEditor,
      permissions: {
        ...delegationEditor.permissions,
        [code]: next,
      },
    });
  }

  async function saveDelegation(event: FormEvent) {
    event.preventDefault();
    if (!selected || !delegationEditor) return;

    const permissions = Object.entries(delegationEditor.permissions)
      .filter(([, item]) => item.enabled)
      .map(([permission, item]) => ({
        permission,
        canGrant: item.canGrant,
        canRevoke: item.canRevoke,
      }));
    if (delegationEditor.targetLevels.length === 0) {
      onMessage("error", "Selecione ao menos um perfil de destino.");
      return;
    }
    if (permissions.length === 0) {
      onMessage("error", "Selecione ao menos um acesso delegável.");
      return;
    }
    if (permissions.some((item) => !item.canGrant && !item.canRevoke)) {
      onMessage(
        "error",
        "Cada acesso selecionado deve permitir concessão, revogação ou ambas.",
      );
      return;
    }

    setBusy(true);
    try {
      const expiresAt = delegationEditor.expiresAt
        ? new Date(delegationEditor.expiresAt).toISOString()
        : null;
      await fetch(
        `/api/admin/organizations/${delegationEditor.organization.id}/access-delegations/${selected.id}`,
        {
          method: "PUT",
          credentials: "include",
          headers,
          body: JSON.stringify({
            version: delegationEditor.version,
            expiresAt,
            targetLevels: delegationEditor.targetLevels,
            permissions,
          }),
        },
      ).then(json);
      onMessage(
        "success",
        "Delegação ativada. O delegado fará a gestão pelos botões por usuário em Projects → Usuários e Acessos.",
      );
      setDelegationEditor(null);
    } catch (error) {
      onMessage(
        "error",
        error instanceof Error ? error.message : "Falha ao salvar a delegação.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disableDelegation() {
    if (!selected || !delegationEditor) return;
    if (
      !confirm(
        `Revogar a delegação de ${selected.email} em ${delegationEditor.organization.name}?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await fetch(
        `/api/admin/organizations/${delegationEditor.organization.id}/access-delegations/${selected.id}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { Accept: "application/json" },
        },
      ).then(json);
      onMessage("success", "Delegação revogada imediatamente.");
      setDelegationEditor(null);
    } catch (error) {
      onMessage(
        "error",
        error instanceof Error
          ? error.message
          : "Falha ao revogar a delegação.",
      );
    } finally {
      setBusy(false);
    }
  }

  const catalogGroups = useMemo(() => {
    if (!delegationEditor) return [];
    return Array.from(
      new Set(delegationEditor.catalog.map((item) => item.group)),
    );
  }, [delegationEditor]);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return users.filter((user) => {
      const userOrganizations = user.organizations || [];
      const nativeRole =
        role(user.role) === "client" ? "owner" : role(user.role);
      const organizationProfiles = userOrganizations.map((item) =>
        role(item.accessLevel) === "client" ? "owner" : role(item.accessLevel),
      );
      const matchesQuery =
        !query ||
        [
          user.name,
          user.email,
          nativeRole,
          ...userOrganizations.flatMap((item) => [
            item.name,
            item.slug,
            item.accessLevel,
          ]),
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(query),
        );
      const matchesOrganization =
        organizationFilter === "all" ||
        userOrganizations.some(
          (item) => String(item.id) === organizationFilter,
        );
      const matchesProfile =
        profileFilter === "all" ||
        nativeRole === profileFilter ||
        organizationProfiles.includes(profileFilter);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active"
          ? user.active !== false
          : user.active === false);

      return (
        matchesQuery && matchesOrganization && matchesProfile && matchesStatus
      );
    });
  }, [users, searchQuery, organizationFilter, profileFilter, statusFilter]);

  function openUser(user: User, view: UserManagementView) {
    setSelectedView(view);
    setSelected(user);
  }

  return (
    <section className="admin-user-manager">
      <header>
        <div>
          <h2>Usuários e Permissões</h2>
          <p>
            Gerencie contas da plataforma, vínculos organizacionais e os limites
            da delegação de acessos.
          </p>
        </div>
        <button
          className="mm-btn primary"
          type="button"
          onClick={() => setCreating(true)}
        >
          ＋ Novo usuário
        </button>
      </header>

      <div className="admin-user-filters" aria-label="Filtros de usuários">
        <label className="wide">
          Buscar
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Nome, e-mail, organização ou perfil"
          />
        </label>
        <label>
          Organização
          <select
            value={organizationFilter}
            onChange={(event) => setOrganizationFilter(event.target.value)}
          >
            <option value="all">Todas</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Perfil
          <select
            value={profileFilter}
            onChange={(event) => setProfileFilter(event.target.value)}
          >
            <option value="all">Todos</option>
            <option value="super_admin">Super Admin</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>
        <label>
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">Todos</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
          </select>
        </label>
        <span className="admin-user-filter-count">
          {filteredUsers.length} de {users.length} usuário(s)
        </span>
      </div>

      <div className="admin-users-table">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Perfil</th>
              <th>Projetos</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user) => (
              <tr key={user.id}>
                <td>{user.name || "—"}</td>
                <td>{user.email}</td>
                <td>{user.role}</td>
                <td>{user.projectCount || 0}</td>
                <td>{user.active === false ? "Inativo" : "Ativo"}</td>
                <td>
                  <div className="admin-users-actions">
                    <button
                      className="mm-btn tiny"
                      type="button"
                      onClick={() => openUser(user, "profile")}
                    >
                      Editar
                    </button>
                    <button
                      className="mm-btn tiny"
                      type="button"
                      onClick={() => openUser(user, "features")}
                    >
                      Gerenciar acessos
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={6} className="admin-users-empty">
                  Nenhum usuário corresponde aos filtros selecionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && draft && (
        <div className="admin-user-modal" role="dialog" aria-modal="true">
          <div className="admin-user-dialog">
            <header>
              <div className="admin-user-dialog-title">
                <span>GESTÃO DO SUPER ADMIN</span>
                <h3>{selected.name || "Usuário sem nome"}</h3>
                <p>
                  {selected.email} •{" "}
                  {selected.active === false ? "Inativo" : "Ativo"}
                </p>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Fechar">
                ×
              </button>
            </header>

            <div className="admin-user-dialog-body">
              <nav
                className="admin-user-dialog-tabs"
                aria-label="Áreas da gestão do usuário"
                role="tablist"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedView === "profile"}
                  className={selectedView === "profile" ? "active" : ""}
                  onClick={() => setSelectedView("profile")}
                >
                  <strong>Dados do usuário</strong>
                  <small>Identificação, perfil, situação e senha</small>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedView === "organizations"}
                  className={selectedView === "organizations" ? "active" : ""}
                  onClick={() => setSelectedView("organizations")}
                >
                  <strong>Organizações</strong>
                  <small>Vínculos e perfil em cada organização</small>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedView === "features"}
                  className={selectedView === "features" ? "active" : ""}
                  onClick={() => setSelectedView("features")}
                >
                  <strong>Funcionalidades</strong>
                  <small>Conceder ou revogar acessos adicionais</small>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedView === "delegation"}
                  className={selectedView === "delegation" ? "active" : ""}
                  onClick={() => setSelectedView("delegation")}
                >
                  <strong>Delegação</strong>
                  <small>Limites para Admin ou Owner delegar</small>
                </button>
              </nav>

              {selectedView === "profile" && (
                <form
                  className="admin-user-profile-form"
                  onSubmit={save}
                  role="tabpanel"
                >
                  <section className="admin-user-management-panel">
                    <header>
                      <div>
                        <h4>Dados da conta</h4>
                        <p>
                          Atualize os dados globais desta conta. A troca de
                          senha encerra as sessões existentes.
                        </p>
                      </div>
                    </header>
                    <div className="admin-user-form-grid">
                      <label>
                        Nome completo
                        <input
                          value={draft.name}
                          onChange={(event) =>
                            setDraft({ ...draft, name: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        E-mail de acesso
                        <input
                          type="email"
                          value={draft.email}
                          onChange={(event) =>
                            setDraft({ ...draft, email: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Perfil nativo da plataforma
                        <select
                          value={draft.role}
                          disabled={role(selected.role) === "super_admin"}
                          onChange={(event) =>
                            setDraft({ ...draft, role: event.target.value })
                          }
                        >
                          {role(selected.role) === "super_admin" && (
                            <option value="super_admin">Super Admin</option>
                          )}
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          <option value="client">Owner</option>
                          <option value="admin">Admin</option>
                        </select>
                      </label>
                      <label>
                        Situação da conta
                        <select
                          value={draft.active ? "active" : "inactive"}
                          disabled={selected.id === currentUserId}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              active: event.target.value === "active",
                            })
                          }
                        >
                          <option value="active">Ativo</option>
                          <option value="inactive">Inativo</option>
                        </select>
                      </label>
                      <label>
                        Projetos vinculados
                        <input value={selected.projectCount || 0} disabled />
                      </label>
                      <label>
                        Nova senha
                        <input
                          type="password"
                          minLength={8}
                          autoComplete="new-password"
                          value={draft.password}
                          onChange={(event) =>
                            setDraft({ ...draft, password: event.target.value })
                          }
                          placeholder="Deixe vazio para manter"
                        />
                      </label>
                    </div>
                  </section>
                  <footer className="admin-user-profile-actions">
                    <button
                      type="button"
                      className="mm-btn danger"
                      disabled={busy || selected.id === currentUserId}
                      onClick={() => void remove()}
                    >
                      Excluir usuário
                    </button>
                    <span />
                    <button
                      type="button"
                      className="mm-btn"
                      onClick={() => setSelected(null)}
                    >
                      Cancelar
                    </button>
                    <button className="mm-btn primary" disabled={busy}>
                      {busy ? "Salvando..." : "Salvar dados"}
                    </button>
                  </footer>
                </form>
              )}

              {isSuperAdmin && selectedView === "organizations" && (
                <section
                  className="admin-user-management-panel"
                  role="tabpanel"
                >
                  <header>
                    <div>
                      <h4>Acesso às organizações</h4>
                      <p>
                        Defina em quais organizações o usuário participa e seu
                        perfil organizacional em cada uma delas.
                      </p>
                    </div>
                  </header>
                  {membershipsLoading && (
                    <p className="admin-memberships-status">
                      Carregando vínculos organizacionais...
                    </p>
                  )}
                  {!membershipsLoading && memberships.length === 0 && (
                    <p className="admin-memberships-status">
                      Nenhuma organização disponível.
                    </p>
                  )}
                  {!membershipsLoading &&
                    memberships.map((organization) => (
                      <article
                        className="admin-organization-membership-row"
                        key={organization.id}
                      >
                        <label className="admin-membership-switch">
                          <input
                            type="checkbox"
                            checked={organization.assigned}
                            disabled={busy}
                            onChange={(event) =>
                              void updateMembership(
                                organization,
                                event.target.checked,
                              )
                            }
                          />
                          <span>
                            <strong>{organization.name}</strong>
                            <small>{organization.slug}</small>
                          </span>
                        </label>
                        <label className="admin-membership-level">
                          Perfil na organização
                          <select
                            value={organization.accessLevel}
                            disabled={!organization.assigned || busy}
                            onChange={(event) =>
                              void updateMembership(
                                organization,
                                true,
                                event.target.value,
                              )
                            }
                          >
                            <option value="viewer">Viewer / Consulta</option>
                            <option value="editor">Editor / Colaborador</option>
                            <option value="owner">Owner / Responsável</option>
                          </select>
                        </label>
                        <span
                          className={
                            organization.assigned
                              ? "admin-membership-state active"
                              : "admin-membership-state"
                          }
                        >
                          {organization.assigned ? "Vinculado" : "Sem acesso"}
                        </span>
                      </article>
                    ))}
                </section>
              )}

              {isSuperAdmin && selectedView === "features" && (
                <section
                  className="admin-user-management-panel"
                  role="tabpanel"
                >
                  <header>
                    <div>
                      <h4>Concessão e revogação de funcionalidades</h4>
                      <p>
                        Abra o painel da organização desejada para revisar cada
                        funcionalidade adicional concedida ao usuário.
                      </p>
                    </div>
                  </header>
                  <div className="admin-user-guidance">
                    <strong>Como esta gestão funciona</strong>
                    <span>
                      As capacidades nativas do perfil são garantidas pelo
                      código e não aparecem como acessos adicionais. Auditoria e
                      Painel Admin são exclusivos do Super Admin.
                    </span>
                  </div>
                  {membershipsLoading && (
                    <p className="admin-memberships-status">
                      Carregando organizações do usuário...
                    </p>
                  )}
                  {!membershipsLoading &&
                    memberships.filter((organization) => organization.assigned)
                      .length === 0 && (
                      <p className="admin-memberships-status">
                        Vincule o usuário a uma organização antes de gerenciar
                        funcionalidades.
                      </p>
                    )}
                  <div className="admin-functionality-scopes">
                    {!membershipsLoading &&
                      memberships
                        .filter((organization) => organization.assigned)
                        .map((organization) => (
                          <article key={organization.id}>
                            <div>
                              <strong>{organization.name}</strong>
                              <small>
                                {organization.slug} • Perfil:{" "}
                                {organization.accessLevel}
                              </small>
                            </div>
                            <button
                              type="button"
                              className="mm-btn primary"
                              disabled={busy || selected.active === false}
                              onClick={() =>
                                setAccessEditor({
                                  organization,
                                  targetUserId: selected.id,
                                })
                              }
                            >
                              Abrir concessão/revogação
                            </button>
                          </article>
                        ))}
                  </div>
                </section>
              )}

              {isSuperAdmin && selectedView === "delegation" && (
                <section
                  className="admin-user-management-panel"
                  role="tabpanel"
                >
                  <header>
                    <div>
                      <h4>Delegação da gestão de acessos</h4>
                      <p>
                        Autorize um Admin ou Owner a conceder e revogar somente
                        a whitelist definida pelo Super Admin.
                      </p>
                    </div>
                  </header>
                  <div className="admin-user-guidance warning">
                    <strong>
                      Delegar não concede funcionalidades diretamente
                    </strong>
                    <span>
                      Esta política apenas habilita o usuário selecionado a
                      gerir terceiros da mesma organização, dentro dos limites
                      escolhidos.
                    </span>
                  </div>
                  {membershipsLoading && (
                    <p className="admin-memberships-status">
                      Carregando organizações do usuário...
                    </p>
                  )}
                  <div className="admin-functionality-scopes">
                    {!membershipsLoading &&
                      memberships
                        .filter((organization) => organization.assigned)
                        .map((organization) => (
                          <article key={organization.id}>
                            <div>
                              <strong>{organization.name}</strong>
                              <small>
                                {organization.slug} • Perfil:{" "}
                                {organization.accessLevel}
                              </small>
                            </div>
                            <button
                              type="button"
                              className="mm-btn delegation"
                              disabled={
                                busy || !isEligibleForDelegation(organization)
                              }
                              title={
                                isEligibleForDelegation(organization)
                                  ? "Configurar limites da delegação"
                                  : "Disponível somente para Admin ou Owner ativo"
                              }
                              onClick={() => void openDelegation(organization)}
                            >
                              Configurar delegação
                            </button>
                          </article>
                        ))}
                  </div>
                  {!membershipsLoading &&
                    !memberships.some((organization) =>
                      isEligibleForDelegation(organization),
                    ) && (
                      <p className="admin-memberships-status">
                        Este usuário não é um Admin ou Owner ativo em nenhuma
                        organização vinculada.
                      </p>
                    )}
                </section>
              )}

              {selectedView !== "profile" && (
                <footer className="admin-user-section-actions">
                  <button
                    type="button"
                    className="mm-btn primary"
                    onClick={() => setSelected(null)}
                  >
                    Concluir gestão
                  </button>
                </footer>
              )}
            </div>
          </div>
        </div>
      )}

      {accessEditor && selected && (
        <OrganizationPermissionManager
          organizationId={accessEditor.organization.id}
          actorUserId={currentUserId}
          initialTargetUserId={accessEditor.targetUserId}
          mode="admin"
          onClose={() => setAccessEditor(null)}
          onSaved={onRefresh}
        />
      )}

      {delegationEditor && selected && (
        <div className="admin-user-modal" role="dialog" aria-modal="true">
          <div className="admin-user-dialog delegation-policy-dialog">
            <header>
              <div>
                <span>PAINEL OBRIGATÓRIO</span>
                <h3>Limites de delegação</h3>
                <p>
                  {selected.name || selected.email} •{" "}
                  {delegationEditor.organization.name}
                </p>
              </div>
              <button
                onClick={() => setDelegationEditor(null)}
                aria-label="Fechar"
              >
                ×
              </button>
            </header>
            <form onSubmit={saveDelegation}>
              <div className="delegation-policy-intro">
                <strong>Delegar acessos da organização</strong>
                <p>
                  Defina exatamente quais perfis, operações e acessos poderão
                  ser atribuídos. Somente o Super Admin configura esta política
                  no Painel Admin. O delegado ativo usa os botões por usuário em
                  Projects → Usuários e Acessos. O código de delegação, GeoJSON
                  amplo e acessos de plataforma ficam fora desta whitelist.
                </p>
              </div>

              <section className="delegation-policy-section">
                <h4>Perfis de destino</h4>
                <div className="delegation-targets">
                  <label>
                    <input
                      type="checkbox"
                      checked={delegationEditor.targetLevels.includes("viewer")}
                      onChange={() => toggleTargetLevel("viewer")}
                    />
                    Consulta
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={delegationEditor.targetLevels.includes("editor")}
                      onChange={() => toggleTargetLevel("editor")}
                    />
                    Colaborador
                  </label>
                </div>
              </section>

              <section className="delegation-policy-section">
                <h4>Acessos permitidos e operações</h4>
                <p>
                  Marque cada acesso e escolha se o delegado poderá conceder,
                  revogar ou executar ambas as operações.
                </p>
                <div className="delegation-catalog">
                  {catalogGroups.map((group) => (
                    <fieldset key={group}>
                      <legend>{group}</legend>
                      {delegationEditor.catalog
                        .filter((item) => item.group === group)
                        .map((item) => {
                          const permission =
                            delegationEditor.permissions[item.code];
                          return (
                            <div key={item.code}>
                              <label className="delegation-access-main">
                                <input
                                  type="checkbox"
                                  checked={permission?.enabled ?? false}
                                  onChange={(event) =>
                                    updateDelegationPermission(item.code, {
                                      enabled: event.target.checked,
                                    })
                                  }
                                />
                                <span>
                                  <strong>{item.name}</strong>
                                  <small>{item.code}</small>
                                </span>
                              </label>
                              <div className="delegation-operations">
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={permission?.canGrant ?? false}
                                    disabled={!permission?.enabled}
                                    onChange={(event) =>
                                      updateDelegationPermission(item.code, {
                                        canGrant: event.target.checked,
                                      })
                                    }
                                  />
                                  Conceder
                                </label>
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={permission?.canRevoke ?? false}
                                    disabled={!permission?.enabled}
                                    onChange={(event) =>
                                      updateDelegationPermission(item.code, {
                                        canRevoke: event.target.checked,
                                      })
                                    }
                                  />
                                  Revogar
                                </label>
                              </div>
                            </div>
                          );
                        })}
                    </fieldset>
                  ))}
                </div>
              </section>

              <section className="delegation-policy-section compact">
                <label>
                  Expiração opcional
                  <input
                    type="datetime-local"
                    value={delegationEditor.expiresAt}
                    onChange={(event) =>
                      setDelegationEditor({
                        ...delegationEditor,
                        expiresAt: event.target.value,
                      })
                    }
                  />
                </label>
                <div className="delegation-policy-protection">
                  <strong>Proteções fixas</strong>
                  <span>Mesma organização</span>
                  <span>Sem autogestão</span>
                  <span>Somente Consulta/Colaborador</span>
                  <span>Teto canônico do owner</span>
                </div>
              </section>

              <footer>
                {delegationEditor.enabled ? (
                  <button
                    type="button"
                    className="mm-btn danger"
                    disabled={busy}
                    onClick={() => void disableDelegation()}
                  >
                    Revogar delegação
                  </button>
                ) : (
                  <span />
                )}
                <span />
                <button
                  type="button"
                  className="mm-btn"
                  onClick={() => setDelegationEditor(null)}
                >
                  Cancelar
                </button>
                <button className="mm-btn primary" disabled={busy}>
                  {busy ? "Salvando política..." : "Salvar política"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {creating && (
        <div className="admin-user-modal" role="dialog" aria-modal="true">
          <div className="admin-user-dialog compact">
            <header>
              <h3>Novo usuário</h3>
              <button onClick={() => setCreating(false)} aria-label="Fechar">
                ×
              </button>
            </header>
            <form onSubmit={create}>
              <div className="admin-user-form-grid">
                <label>
                  Nome
                  <input name="name" required />
                </label>
                <label>
                  E-mail
                  <input name="email" type="email" required />
                </label>
                <label>
                  Perfil
                  <select name="role">
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="client">Cliente/Owner</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <label>
                  Senha inicial
                  <input
                    name="password"
                    type="password"
                    minLength={8}
                    autoComplete="new-password"
                    required
                  />
                </label>
              </div>
              <footer>
                <span />
                <span />
                <button
                  type="button"
                  className="mm-btn"
                  onClick={() => setCreating(false)}
                >
                  Cancelar
                </button>
                <button className="mm-btn primary" disabled={busy}>
                  Criar usuário
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
