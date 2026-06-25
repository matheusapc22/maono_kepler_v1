import { useCallback, useEffect, useMemo, useState } from "react";

import type { MaonoUser } from "../../../auth/session";
import {
  createOrganizationUser,
  grantOrganizationUserPermission,
  listOrganizationUsers,
  revokeOrganizationUserPermission,
  updateOrganizationUser,
  type CreateOrganizationUserPayload,
  type OrganizationUser,
  type UpdateOrganizationUserPayload,
} from "../../../lib/api";

type ApiId = number | string;

type RoleValue =
  | "super_admin"
  | "admin"
  | "owner"
  | "editor"
  | "viewer"
  | "client"
  | string;

type AccessLevelValue = "owner" | "editor" | "viewer" | string;

type CreateUserForm = {
  name: string;
  email: string;
  role: RoleValue;
  accessLevel: AccessLevelValue;
};

type UserDraft = {
  name: string;
  role: RoleValue;
  accessLevel: AccessLevelValue;
};

type PermissionOption = {
  value: string;
  label: string;
  description: string;
  ownerGrantable?: boolean;
  superAdminOnly?: boolean;
  sensitive?: boolean;
};

type ApiErrorLike = Error & {
  status?: number;
  code?: string;
  payload?: unknown;
};

const ROLE_OPTIONS = [
  { value: "viewer", label: "Viewer" },
  { value: "editor", label: "Editor" },
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super Admin" },
] as const;

const ACCESS_LEVEL_OPTIONS = [
  { value: "viewer", label: "Viewer" },
  { value: "editor", label: "Editor" },
  { value: "owner", label: "Owner" },
] as const;

const PERMISSION_OPTIONS: PermissionOption[] = [
  {
    value: "document.view",
    label: "Ver documentos",
    description: "Permite acessar a lista de documentos.",
    ownerGrantable: true,
  },
  {
    value: "document.upload",
    label: "Enviar documentos",
    description: "Permite enviar arquivos para a organização.",
    ownerGrantable: true,
  },
  {
    value: "document.download",
    label: "Baixar documentos",
    description: "Permite baixar documentos autorizados.",
    ownerGrantable: true,
  },
  {
    value: "document.delete",
    label: "Excluir documentos",
    description: "Permite excluir documentos autorizados.",
    ownerGrantable: true,
  },
  {
    value: "ticket.view",
    label: "Ver chamados",
    description: "Permite acessar chamados da organização.",
    ownerGrantable: true,
  },
  {
    value: "ticket.create",
    label: "Criar chamados",
    description: "Permite abrir chamados.",
    ownerGrantable: true,
  },
  {
    value: "ticket.manage",
    label: "Gerenciar chamados",
    description: "Permite alterar status e prioridade dos chamados.",
  },
  {
    value: "export.view",
    label: "Ver exportações",
    description: "Permite listar exportações.",
    ownerGrantable: true,
  },
  {
    value: "export.create",
    label: "Criar exportações",
    description: "Permite solicitar exportações.",
    ownerGrantable: true,
  },
  {
    value: "export.download",
    label: "Baixar exportações",
    description: "Permite baixar arquivos de exportação.",
  },
  {
    value: "users.view",
    label: "Ver usuários",
    description: "Permite acessar usuários e acessos.",
    ownerGrantable: true,
    sensitive: true,
  },
  {
    value: "users.create",
    label: "Criar usuários",
    description: "Permite criar usuários na organização.",
    sensitive: true,
  },
  {
    value: "users.edit",
    label: "Editar usuários",
    description: "Permite editar dados básicos de usuários.",
    sensitive: true,
  },
  {
    value: "users.disable",
    label: "Desativar usuários",
    description: "Permite desativar usuários.",
    sensitive: true,
  },
  {
    value: "users.manage_access",
    label: "Gerenciar acessos",
    description: "Permite gerenciar permissões de usuários.",
    sensitive: true,
  },
  {
    value: "permission.grant",
    label: "Conceder permissões",
    description: "Permite conceder permissões.",
    sensitive: true,
  },
  {
    value: "permission.revoke",
    label: "Revogar permissões",
    description: "Permite revogar permissões.",
    sensitive: true,
  },
  {
    value: "role.assign",
    label: "Atribuir papel",
    description: "Permite alterar role ou accessLevel.",
    sensitive: true,
  },
  {
    value: "organization.view",
    label: "Ver organização",
    description: "Permite acessar dados gerenciais da organização.",
    ownerGrantable: true,
  },
  {
    value: "organization.metrics.view",
    label: "Ver métricas",
    description: "Permite visualizar métricas da organização.",
    ownerGrantable: true,
  },
  {
    value: "organization.edit",
    label: "Editar organização",
    description: "Permissão catalogada; endpoint PATCH não existe nesta sprint.",
    sensitive: true,
  },
  {
    value: "limits.view",
    label: "Ver limites",
    description: "Permite acessar limites e plano atual.",
    ownerGrantable: true,
  },
  {
    value: "limits.increase_request",
    label: "Solicitar aumento",
    description: "Permite solicitar upgrade ou aumento de limite.",
    ownerGrantable: true,
  },
  {
    value: "admin.panel.access",
    label: "Painel Admin",
    description: "Permite acessar o painel administrativo Maõno.",
    superAdminOnly: true,
    sensitive: true,
  },
  {
    value: "audit.view",
    label: "Ver auditoria",
    description: "Permite acessar logs de auditoria.",
    superAdminOnly: true,
    sensitive: true,
  },
];

const SPRINT_8_UI_PERMISSIONS = new Set([
  "users.view",
  "users.create",
  "users.edit",
  "users.disable",
  "users.manage_access",
  "permission.grant",
  "permission.revoke",
  "role.assign",
  "organization.view",
  "organization.edit",
  "organization.metrics.view",
  "limits.view",
  "limits.increase_request",
]);

const OWNER_UI_PERMISSIONS = new Set([
  "users.view",
  "users.create",
  "users.edit",
  "users.disable",
  "users.manage_access",
  "permission.grant",
  "permission.revoke",
  "role.assign",
  "organization.view",
  "organization.metrics.view",
  "limits.view",
  "limits.increase_request",
]);

const DEFAULT_CREATE_FORM: CreateUserForm = {
  name: "",
  email: "",
  role: "viewer",
  accessLevel: "viewer",
};

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

function normalizeAccessLevel(accessLevel: unknown): string {
  return String(accessLevel || "viewer").trim().toLowerCase();
}

function getOrganizationId(user: MaonoUser | null): ApiId | null {
  const data = readObject(user);

  const value =
    data.activeOrganizationId ??
    data.organizationId ??
    data.organization_id ??
    null;

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return null;
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

  if (isAdmin(user) && SPRINT_8_UI_PERMISSIONS.has(permission)) {
    return true;
  }

  if (isOwner(user) && OWNER_UI_PERMISSIONS.has(permission)) {
    return true;
  }

  return false;
}

function availableRoleOptions(user: MaonoUser | null) {
  if (isSuperAdmin(user)) {
    return ROLE_OPTIONS;
  }

  if (isAdmin(user)) {
    return ROLE_OPTIONS.filter((option) => option.value !== "super_admin");
  }

  if (isOwner(user)) {
    return ROLE_OPTIONS.filter(
      (option) => option.value === "viewer" || option.value === "editor",
    );
  }

  return ROLE_OPTIONS.filter((option) => option.value === "viewer");
}

function availableAccessLevelOptions(user: MaonoUser | null) {
  if (isSuperAdmin(user) || isAdmin(user)) {
    return ACCESS_LEVEL_OPTIONS;
  }

  if (isOwner(user)) {
    return ACCESS_LEVEL_OPTIONS.filter(
      (option) => option.value === "viewer" || option.value === "editor",
    );
  }

  return ACCESS_LEVEL_OPTIONS.filter((option) => option.value === "viewer");
}

function availablePermissionOptions(user: MaonoUser | null) {
  if (isSuperAdmin(user)) {
    return PERMISSION_OPTIONS;
  }

  if (isAdmin(user)) {
    return PERMISSION_OPTIONS.filter((option) => !option.superAdminOnly);
  }

  if (isOwner(user)) {
    return PERMISSION_OPTIONS.filter((option) => option.ownerGrantable);
  }

  return PERMISSION_OPTIONS.filter((option) =>
    hasExplicitPermission(user, option.value),
  );
}

function roleLabel(role: unknown): string {
  const normalized = normalizeRole(role);

  if (normalized === "super_admin") return "Super Admin";
  if (normalized === "admin") return "Admin";
  if (normalized === "owner" || normalized === "client") return "Owner";
  if (normalized === "editor") return "Editor";
  if (normalized === "viewer") return "Viewer";

  return String(role || "Usuário");
}

function accessLevelLabel(accessLevel: unknown): string {
  const normalized = normalizeAccessLevel(accessLevel);

  if (normalized === "owner") return "Owner";
  if (normalized === "editor") return "Editor";
  if (normalized === "viewer") return "Viewer";

  return String(accessLevel || "Viewer");
}

function roleTagClassName(role: unknown): string {
  const normalized = normalizeRole(role);

  if (normalized === "super_admin" || normalized === "admin") {
    return "mm-tag gold";
  }

  if (normalized === "owner" || normalized === "client") {
    return "mm-tag green";
  }

  return "mm-tag";
}

function statusTagClassName(active: unknown): string {
  return active === false ? "mm-tag red" : "mm-tag green";
}

function userKey(user: OrganizationUser): string {
  return String(user.id);
}

function createDraftFromUser(user: OrganizationUser): UserDraft {
  return {
    name: user.name || "",
    role: normalizeRole(user.role),
    accessLevel: normalizeAccessLevel(user.accessLevel),
  };
}

function syncDraftsFromUsers(
  users: OrganizationUser[],
  currentDrafts: Record<string, UserDraft>,
): Record<string, UserDraft> {
  const nextDrafts: Record<string, UserDraft> = {};

  for (const user of users) {
    const key = userKey(user);
    nextDrafts[key] = currentDrafts[key] ?? createDraftFromUser(user);
  }

  return nextDrafts;
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

function userHasPermission(user: OrganizationUser, permission: string): boolean {
  return Boolean(user.permissions?.includes(permission));
}

function countActiveUsers(users: OrganizationUser[]): number {
  return users.filter((user) => user.active !== false).length;
}

function countOwners(users: OrganizationUser[]): number {
  return users.filter(
    (user) =>
      normalizeRole(user.role) === "owner" ||
      normalizeAccessLevel(user.accessLevel) === "owner",
  ).length;
}

function getSelectablePermissionDescription(permission: string): string {
  return (
    PERMISSION_OPTIONS.find((option) => option.value === permission)
      ?.description || permission
  );
}

export default function UsersAccessSection({
  user,
}: {
  user: MaonoUser | null;
}) {
  const organizationId = useMemo(() => getOrganizationId(user), [user]);

  const roleOptions = useMemo(() => availableRoleOptions(user), [user]);
  const accessLevelOptions = useMemo(
    () => availableAccessLevelOptions(user),
    [user],
  );
  const permissionOptions = useMemo(
    () => availablePermissionOptions(user),
    [user],
  );

  const permissions = useMemo(
    () => ({
      view: canVisually(user, "users.view"),
      create: canVisually(user, "users.create"),
      edit: canVisually(user, "users.edit"),
      disable: canVisually(user, "users.disable"),
      manageAccess: canVisually(user, "users.manage_access"),
      grant: canVisually(user, "permission.grant"),
      revoke: canVisually(user, "permission.revoke"),
      roleAssign: canVisually(user, "role.assign"),
    }),
    [user],
  );

  const canManageRoleOrAccess =
    permissions.roleAssign || permissions.manageAccess;

  const canGrantPermission = permissions.manageAccess && permissions.grant;
  const canRevokePermission = permissions.manageAccess && permissions.revoke;

  const [users, setUsers] = useState<OrganizationUser[]>([]);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [createForm, setCreateForm] =
    useState<CreateUserForm>(DEFAULT_CREATE_FORM);
  const [grantTargetUserId, setGrantTargetUserId] = useState<string>("");
  const [grantPermission, setGrantPermission] = useState<string>(
    permissionOptions[0]?.value || "document.view",
  );
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    if (!organizationId || !permissions.view) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await listOrganizationUsers(organizationId);
      const nextUsers = response.users || [];

      setUsers(nextUsers);
      setDrafts((currentDrafts) =>
        syncDraftsFromUsers(nextUsers, currentDrafts),
      );

      if (!grantTargetUserId && nextUsers[0]) {
        setGrantTargetUserId(String(nextUsers[0].id));
      }
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setLoading(false);
    }
  }, [grantTargetUserId, organizationId, permissions.view]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (
      permissionOptions.length > 0 &&
      !permissionOptions.some((option) => option.value === grantPermission)
    ) {
      setGrantPermission(permissionOptions[0].value);
    }
  }, [grantPermission, permissionOptions]);

  function updateCreateForm<K extends keyof CreateUserForm>(
    key: K,
    value: CreateUserForm[K],
  ) {
    setCreateForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateDraft<K extends keyof UserDraft>(
    targetUser: OrganizationUser,
    key: K,
    value: UserDraft[K],
  ) {
    const keyValue = userKey(targetUser);

    setDrafts((current) => ({
      ...current,
      [keyValue]: {
        ...(current[keyValue] ?? createDraftFromUser(targetUser)),
        [key]: value,
      },
    }));
  }

  async function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organizationId || !permissions.create) {
      setErrorMessage("Você não tem permissão para criar usuários.");
      return;
    }

    const payload: CreateOrganizationUserPayload = {
      name: createForm.name.trim(),
      email: createForm.email.trim(),
      role: createForm.role,
      accessLevel: createForm.accessLevel,
    };

    if (!payload.name || !payload.email) {
      setErrorMessage("Informe nome e e-mail para criar usuário.");
      return;
    }

    setBusyKey("create");
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await createOrganizationUser(organizationId, payload);
      setCreateForm(DEFAULT_CREATE_FORM);
      setSuccessMessage("Usuário criado com sucesso.");
      await loadUsers();
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleSaveUser(targetUser: OrganizationUser) {
    if (!organizationId) {
      setErrorMessage("Organização ativa não identificada.");
      return;
    }

    const key = userKey(targetUser);
    const draft = drafts[key] ?? createDraftFromUser(targetUser);
    const payload: UpdateOrganizationUserPayload = {};

    const nextName = draft.name.trim();
    const currentName = targetUser.name || "";

    if (nextName && nextName !== currentName) {
      if (!permissions.edit) {
        setErrorMessage("Você não tem permissão para editar usuários.");
        return;
      }

      payload.name = nextName;
    }

    if (draft.role && draft.role !== normalizeRole(targetUser.role)) {
      if (!canManageRoleOrAccess) {
        setErrorMessage("Você não tem permissão para alterar role.");
        return;
      }

      payload.role = draft.role;
    }

    if (
      draft.accessLevel &&
      draft.accessLevel !== normalizeAccessLevel(targetUser.accessLevel)
    ) {
      if (!canManageRoleOrAccess) {
        setErrorMessage("Você não tem permissão para alterar accessLevel.");
        return;
      }

      payload.accessLevel = draft.accessLevel;
    }

    if (Object.keys(payload).length === 0) {
      setSuccessMessage("Nenhuma alteração pendente para salvar.");
      return;
    }

    setBusyKey(`save:${key}`);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await updateOrganizationUser(organizationId, targetUser.id, payload);
      setSuccessMessage("Usuário atualizado com sucesso.");
      await loadUsers();
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleToggleActive(targetUser: OrganizationUser) {
    if (!organizationId) {
      setErrorMessage("Organização ativa não identificada.");
      return;
    }

    const nextActive = targetUser.active === false;
    const canToggle = nextActive ? permissions.edit : permissions.disable;

    if (!canToggle) {
      setErrorMessage(
        nextActive
          ? "Você não tem permissão para reativar usuários."
          : "Você não tem permissão para desativar usuários.",
      );
      return;
    }

    const key = userKey(targetUser);

    setBusyKey(`active:${key}`);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await updateOrganizationUser(organizationId, targetUser.id, {
        active: nextActive,
      });

      setSuccessMessage(
        nextActive
          ? "Usuário reativado com sucesso."
          : "Usuário desativado com sucesso.",
      );

      await loadUsers();
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleGrantPermission(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organizationId || !canGrantPermission) {
      setErrorMessage("Você não tem permissão para conceder permissões.");
      return;
    }

    if (!grantTargetUserId || !grantPermission) {
      setErrorMessage("Selecione usuário e permissão.");
      return;
    }

    const targetUser = users.find(
      (item) => String(item.id) === String(grantTargetUserId),
    );

    if (targetUser && userHasPermission(targetUser, grantPermission)) {
      setErrorMessage("Este usuário já possui a permissão selecionada.");
      return;
    }

    setBusyKey("grant");
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await grantOrganizationUserPermission(
        organizationId,
        grantTargetUserId,
        grantPermission,
      );

      setSuccessMessage("Permissão concedida com sucesso.");
      await loadUsers();
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRevokePermission(
    targetUser: OrganizationUser,
    permission: string,
  ) {
    if (!organizationId || !canRevokePermission) {
      setErrorMessage("Você não tem permissão para revogar permissões.");
      return;
    }

    const key = userKey(targetUser);

    setBusyKey(`revoke:${key}:${permission}`);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await revokeOrganizationUserPermission(
        organizationId,
        targetUser.id,
        permission,
      );

      setSuccessMessage("Permissão revogada com sucesso.");
      await loadUsers();
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setBusyKey(null);
    }
  }

  const activeUsersCount = countActiveUsers(users);
  const inactiveUsersCount = users.length - activeUsersCount;
  const ownersCount = countOwners(users);

  if (!organizationId) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Usuários e Acessos</h2>
        <p>Não foi possível identificar a organização ativa da sessão.</p>
      </section>
    );
  }

  if (!permissions.view) {
    return (
      <section className="mm-card mm-section-card">
        <h2>Usuários e Acessos</h2>
        <p>Você não possui permissão para visualizar usuários desta organização.</p>
      </section>
    );
  }

  return (
    <section className="mm-card mm-section-card">
      <h2>Usuários e Acessos</h2>
      <p>
        Gestão de usuários internos, accessLevel, status e permissões granulares
        da organização. A UI apenas oculta ações; a validação real acontece no
        backend.
      </p>

      <div className="mm-metrics-grid compact">
        <div className="mm-card metric">
          <span>Total</span>
          <strong>{users.length}</strong>
        </div>

        <div className="mm-card metric">
          <span>Ativos</span>
          <strong>{activeUsersCount}</strong>
        </div>

        <div className="mm-card metric">
          <span>Inativos</span>
          <strong>{inactiveUsersCount}</strong>
        </div>

        <div className="mm-card metric">
          <span>Owners</span>
          <strong>{ownersCount}</strong>
        </div>
      </div>

      {errorMessage && (
        <div className="mm-card" role="alert">
          <strong>Erro</strong>
          <p>{errorMessage}</p>
        </div>
      )}

      {successMessage && (
        <div className="mm-card" role="status">
          <strong>Sucesso</strong>
          <p>{successMessage}</p>
        </div>
      )}

      {permissions.create ? (
        <form className="mm-card" onSubmit={handleCreateUser}>
          <h3>Criar usuário</h3>

          <div className="mm-form-grid">
            <label>
              Nome
              <input
                value={createForm.name}
                onChange={(event) =>
                  updateCreateForm("name", event.target.value)
                }
                placeholder="Nome do usuário"
              />
            </label>

            <label>
              E-mail
              <input
                value={createForm.email}
                onChange={(event) =>
                  updateCreateForm("email", event.target.value)
                }
                placeholder="email@dominio.com"
                type="email"
              />
            </label>

            <label>
              Role
              <select
                value={createForm.role}
                onChange={(event) =>
                  updateCreateForm("role", event.target.value)
                }
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              AccessLevel
              <select
                value={createForm.accessLevel}
                onChange={(event) =>
                  updateCreateForm("accessLevel", event.target.value)
                }
              >
                {accessLevelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mm-actions-row">
            <button
              type="submit"
              className="mm-btn primary"
              disabled={busyKey === "create"}
            >
              {busyKey === "create" ? "Criando..." : "Criar usuário"}
            </button>

            <span className="mm-tag">
              Owner cria apenas Viewer/Editor pela UI
            </span>
          </div>
        </form>
      ) : (
        <div className="mm-card">
          <strong>Criação indisponível</strong>
          <p>Seu perfil não possui permissão visual para criar usuários.</p>
        </div>
      )}

      <div className="mm-card">
        <h3>Conceder permissão</h3>

        {canGrantPermission ? (
          <form onSubmit={handleGrantPermission}>
            <div className="mm-form-grid">
              <label>
                Usuário
                <select
                  value={grantTargetUserId}
                  onChange={(event) => setGrantTargetUserId(event.target.value)}
                >
                  {users.map((item) => (
                    <option key={item.id} value={String(item.id)}>
                      {item.name || item.email || `Usuário ${item.id}`}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Permissão
                <select
                  value={grantPermission}
                  onChange={(event) => setGrantPermission(event.target.value)}
                >
                  {permissionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} · {option.value}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mm-form-actions">
                <button
                  type="submit"
                  className="mm-btn primary"
                  disabled={busyKey === "grant" || users.length === 0}
                >
                  {busyKey === "grant" ? "Concedendo..." : "Conceder"}
                </button>
              </div>
            </div>

            <p>{getSelectablePermissionDescription(grantPermission)}</p>
          </form>
        ) : (
          <p>Seu perfil não possui permissão visual para conceder permissões.</p>
        )}
      </div>

      <div className="mm-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Usuário</th>
              <th>Status</th>
              <th>Role</th>
              <th>AccessLevel</th>
              <th>Permissões</th>
              <th>Ações</th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan={6}>Carregando usuários...</td>
              </tr>
            )}

            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={6}>Nenhum usuário encontrado.</td>
              </tr>
            )}

            {!loading &&
              users.map((item) => {
                const key = userKey(item);
                const draft = drafts[key] ?? createDraftFromUser(item);
                const canToggleActive =
                  item.active === false ? permissions.edit : permissions.disable;

                return (
                  <tr key={key}>
                    <td>
                      <input
                        value={draft.name}
                        disabled={!permissions.edit}
                        onChange={(event) =>
                          updateDraft(item, "name", event.target.value)
                        }
                        placeholder="Nome"
                      />

                      <div className="mm-muted">{item.email}</div>
                    </td>

                    <td>
                      <span className={statusTagClassName(item.active)}>
                        {item.active === false ? "Inativo" : "Ativo"}
                      </span>
                    </td>

                    <td>
                      <select
                        value={draft.role}
                        disabled={!canManageRoleOrAccess}
                        onChange={(event) =>
                          updateDraft(item, "role", event.target.value)
                        }
                      >
                        {roleOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>

                      <div>
                        <span className={roleTagClassName(item.role)}>
                          {roleLabel(item.role)}
                        </span>
                      </div>
                    </td>

                    <td>
                      <select
                        value={draft.accessLevel}
                        disabled={!canManageRoleOrAccess}
                        onChange={(event) =>
                          updateDraft(item, "accessLevel", event.target.value)
                        }
                      >
                        {accessLevelOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>

                      <div>
                        <span className="mm-tag">
                          {accessLevelLabel(item.accessLevel)}
                        </span>
                      </div>
                    </td>

                    <td>
                      <div className="mm-tags-list">
                        {(item.permissions || []).length === 0 && (
                          <span className="mm-tag">Sem permissões extras</span>
                        )}

                        {(item.permissions || []).map((permission) => (
                          <span key={permission} className="mm-tag">
                            {permission}

                            {canRevokePermission && (
                              <button
                                type="button"
                                className="mm-btn tiny"
                                disabled={
                                  busyKey === `revoke:${key}:${permission}`
                                }
                                onClick={() => {
                                  void handleRevokePermission(item, permission);
                                }}
                                title={`Revogar ${permission}`}
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    </td>

                    <td>
                      <div className="mm-actions-row">
                        <button
                          type="button"
                          className="mm-btn primary"
                          disabled={
                            busyKey === `save:${key}` ||
                            (!permissions.edit && !canManageRoleOrAccess)
                          }
                          onClick={() => {
                            void handleSaveUser(item);
                          }}
                        >
                          {busyKey === `save:${key}` ? "Salvando..." : "Salvar"}
                        </button>

                        <button
                          type="button"
                          className="mm-btn"
                          disabled={busyKey === `active:${key}` || !canToggleActive}
                          onClick={() => {
                            void handleToggleActive(item);
                          }}
                        >
                          {item.active === false ? "Reativar" : "Desativar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="mm-card">
        <strong>Permissões visuais nesta tela</strong>

        <div className="mm-tags-list">
          <span className={permissions.view ? "mm-tag green" : "mm-tag red"}>
            users.view
          </span>
          <span className={permissions.create ? "mm-tag green" : "mm-tag red"}>
            users.create
          </span>
          <span className={permissions.edit ? "mm-tag green" : "mm-tag red"}>
            users.edit
          </span>
          <span className={permissions.disable ? "mm-tag green" : "mm-tag red"}>
            users.disable
          </span>
          <span
            className={permissions.manageAccess ? "mm-tag green" : "mm-tag red"}
          >
            users.manage_access
          </span>
          <span className={permissions.grant ? "mm-tag green" : "mm-tag red"}>
            permission.grant
          </span>
          <span className={permissions.revoke ? "mm-tag green" : "mm-tag red"}>
            permission.revoke
          </span>
          <span
            className={permissions.roleAssign ? "mm-tag green" : "mm-tag red"}
          >
            role.assign
          </span>
        </div>

        <p>
          Estes indicadores servem apenas para orientar a interface. Todas as
          ações sensíveis continuam sendo validadas pelos endpoints da API.
        </p>
      </div>
    </section>
  );
}