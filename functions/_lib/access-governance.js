import { normalizeRole } from "./auth.js";
import { PERMISSIONS, can, recordAuditLog } from "./permissions.js";

export const ORGANIZATION_ACCESS_DELEGATE_PERMISSION =
  "organization.users.permissions.delegate";

const TARGET_LEVELS = new Set(["viewer", "editor"]);

export const DELEGABLE_PERMISSION_CATALOG = Object.freeze([
  { code: "document.view", group: "Arquivos e documentos", name: "Consultar documentos", description: "Ver a lista de documentos comuns da organização.", risk: "standard", ownerDelegable: true },
  { code: "document.upload", group: "Arquivos e documentos", name: "Enviar documentos", description: "Adicionar documentos comuns à organização.", risk: "operational", ownerDelegable: true },
  { code: "document.download", group: "Arquivos e documentos", name: "Baixar documentos", description: "Baixar documentos comuns permitidos.", risk: "sensitive", ownerDelegable: true },
  { code: "document.delete", group: "Arquivos e documentos", name: "Excluir documentos", description: "Excluir documentos comuns da organização.", risk: "irreversible", ownerDelegable: true },
  { code: "ticket.view", group: "Central de chamados", name: "Acompanhar chamados", description: "Consultar chamados da organização.", risk: "standard", ownerDelegable: true },
  { code: "ticket.create", group: "Central de chamados", name: "Abrir novos chamados", description: "Criar chamados para a organização.", risk: "operational", ownerDelegable: true },
  { code: "ticket.comment", group: "Central de chamados", name: "Comentar em chamados", description: "Adicionar comentários em chamados.", risk: "operational", ownerDelegable: true },
  { code: "export.view", group: "Exportações", name: "Consultar exportações", description: "Ver exportações solicitadas.", risk: "standard", ownerDelegable: true },
  { code: "export.create", group: "Exportações", name: "Criar exportações", description: "Solicitar novas exportações.", risk: "operational", ownerDelegable: true },
  { code: "users.view", group: "Equipe e acessos", name: "Consultar equipe", description: "Ver as pessoas da organização.", risk: "sensitive", ownerDelegable: true },
  { code: "organization.view", group: "Organização e capacidade", name: "Consultar dados da organização", description: "Ver informações da organização.", risk: "standard", ownerDelegable: true },
  { code: "organization.metrics.view", group: "Organização e capacidade", name: "Consultar indicadores da organização", description: "Ver indicadores da organização.", risk: "standard", ownerDelegable: true },
  { code: "limits.view", group: "Organização e capacidade", name: "Consultar limites do plano", description: "Ver consumo e limites contratados.", risk: "standard", ownerDelegable: true },
  { code: "limits.increase_request", group: "Organização e capacidade", name: "Solicitar mais capacidade", description: "Solicitar aumento de capacidade.", risk: "operational", ownerDelegable: true },
]);

const BLOCKED_PERMISSION_PRESENTATION = Object.freeze([
  ["project.view", "Projetos", "Consultar projetos", "Exige vínculo individual com o projeto.", "sensitive"],
  ["project.create", "Projetos", "Criar projetos", "Cria recursos fora da delegação de acessos adicionais.", "operational"],
  ["project.edit", "Projetos", "Editar projetos", "Exige escopo individual de projeto.", "sensitive"],
  ["project.save", "Projetos", "Salvar projetos", "Exige escopo individual de projeto.", "sensitive"],
  ["project.favorite", "Projetos", "Favoritar projetos", "Exige escopo individual de projeto.", "standard"],
  ["project.thumbnail.update", "Projetos", "Atualizar capas", "Exige escopo individual de projeto.", "operational"],
  ["document.edit", "Arquivos e documentos", "Editar documentos", "Fora do teto canônico de delegação do owner.", "sensitive"],
  ["document.manage", "Arquivos e documentos", "Administrar documentos", "A gestão completa não pode ser redelegada.", "platform"],
  ["ticket.manage", "Central de chamados", "Administrar chamados", "Fora do teto canônico de delegação do owner.", "sensitive"],
  ["ticket.close", "Central de chamados", "Encerrar chamados", "Fora do teto canônico de delegação do owner.", "operational"],
  ["ticket.assign", "Central de chamados", "Atribuir chamados", "Fora do teto canônico de delegação do owner.", "sensitive"],
  ["export.download", "Exportações", "Baixar exportações", "Fora do teto canônico de delegação do owner.", "sensitive"],
  ["export.manage", "Exportações", "Administrar exportações", "A gestão completa não pode ser redelegada.", "platform"],
  ["roadmap.view", "Roadmap", "Consultar roadmap", "Roadmap será incluído após reconciliação própria de escopo.", "standard"],
  ["roadmap.comment.create", "Roadmap", "Comentar no roadmap", "Roadmap será incluído após reconciliação própria de escopo.", "operational"],
  ["roadmap.comment.edit_own", "Roadmap", "Editar comentário próprio", "Roadmap será incluído após reconciliação própria de escopo.", "operational"],
  ["roadmap.comment.moderate", "Roadmap", "Moderar comentários", "Roadmap será incluído após reconciliação própria de escopo.", "sensitive"],
  ["roadmap.manage", "Roadmap", "Administrar roadmap", "Roadmap será incluído após reconciliação própria de escopo.", "platform"],
  ["roadmap.task.manage", "Roadmap", "Administrar tarefas", "Roadmap será incluído após reconciliação própria de escopo.", "platform"],
  ["roadmap.dependency.manage", "Roadmap", "Administrar dependências", "Roadmap será incluído após reconciliação própria de escopo.", "platform"],
  ["users.create", "Equipe e acessos", "Adicionar pessoas", "A delegação permite gerir acessos adicionais, não criar contas.", "sensitive"],
  ["users.edit", "Equipe e acessos", "Editar pessoas", "A delegação permite gerir acessos adicionais, não editar contas.", "sensitive"],
  ["users.disable", "Equipe e acessos", "Suspender pessoas", "A delegação permite gerir acessos adicionais, não suspender contas.", "irreversible"],
  ["users.delete", "Equipe e acessos", "Remover pessoas", "A delegação permite gerir acessos adicionais, não remover vínculos.", "irreversible"],
  ["users.invite", "Equipe e acessos", "Convidar pessoas", "Fora do teto de acessos adicionais delegados.", "sensitive"],
  ["users.manage_access", "Governança", "Administrar acessos sem limites", "A gestão deve permanecer limitada à política desta organização.", "platform"],
  ["permission.grant", "Governança", "Conceder qualquer acesso", "Não pode substituir a whitelist configurada pelo Super Admin.", "platform"],
  ["permission.revoke", "Governança", "Revogar qualquer acesso", "Não pode substituir a whitelist configurada pelo Super Admin.", "platform"],
  ["role.assign", "Governança", "Alterar perfis", "A delegação não permite promover perfis.", "platform"],
  ["organization.edit", "Organização e capacidade", "Editar organização", "Fora do teto canônico de delegação do owner.", "platform"],
  ["organization.projects.geojson.view", "Projetos", "Visualizar GeoJSON de todos os projetos", "Permanece sob concessão direta e exclusiva do Super Admin.", "sensitive"],
  ["billing.view", "Organização e capacidade", "Consultar cobrança", "Informação financeira fora da delegação operacional.", "sensitive"],
  ["plan.view", "Organização e capacidade", "Consultar plano", "Fora do teto canônico de delegação do owner.", "sensitive"],
  ["plan.change_request", "Organização e capacidade", "Solicitar mudança de plano", "Fora do teto canônico de delegação do owner.", "operational"],
  ["admin.panel.access", "Administração Maõno", "Acessar administração global", "Acesso reservado à administração da plataforma.", "platform"],
  ["audit.view", "Administração Maõno", "Consultar auditoria", "Acesso reservado à administração da plataforma.", "platform"],
  ["audit.export", "Administração Maõno", "Exportar auditoria", "Acesso reservado à administração da plataforma.", "platform"],
  ["audit.security.view", "Administração Maõno", "Consultar auditoria de segurança", "Acesso reservado à administração da plataforma.", "platform"],
  ["audit.platform.view", "Administração Maõno", "Consultar auditoria da plataforma", "Acesso reservado à administração da plataforma.", "platform"],
  ["audit.organization.view", "Administração Maõno", "Consultar auditoria da organização", "Acesso reservado à administração da plataforma.", "platform"],
  [ORGANIZATION_ACCESS_DELEGATE_PERMISSION, "Governança", "Delegar a gestão de acessos", "A meta-delegação permanece exclusiva do Super Admin.", "platform"],
]);

const PRESENTATION_BY_CODE = new Map(
  BLOCKED_PERMISSION_PRESENTATION.map(([code, group, name, description, risk]) => [
    code,
    { code, group, name, description, risk },
  ]),
);
const DELEGABLE_CODES = new Set(DELEGABLE_PERMISSION_CATALOG.map((item) => item.code));

export const DELEGATION_POLICY_CATALOG = Object.freeze(
  DELEGABLE_PERMISSION_CATALOG.map((item) => ({
    ...item,
    disabledReason: null,
  })).concat(
    Array.from(new Set([...PERMISSIONS, ORGANIZATION_ACCESS_DELEGATE_PERMISSION]))
      .filter((code) => !DELEGABLE_CODES.has(code))
      .map((code) => ({
        ...(PRESENTATION_BY_CODE.get(code) || {
          code,
          group: "Outros acessos",
          name: "Acesso restrito",
          description: "Este acesso não integra a delegação organizacional.",
          risk: "platform",
        }),
        ownerDelegable: false,
        disabledReason:
          PRESENTATION_BY_CODE.get(code)?.description ||
          "Fora do teto canônico de delegação do owner.",
      })),
  ),
);

const CATALOG_BY_CODE = new Map(
  DELEGABLE_PERMISSION_CATALOG.map((item) => [item.code, item]),
);

const SUPER_ADMIN_PROJECTS_PERMISSIONS = Object.freeze([
  ...DELEGABLE_PERMISSION_CATALOG.map((item) => item.code),
  "organization.projects.geojson.view",
  "project.view",
  "project.create",
  "project.edit",
  "project.save",
  "project.favorite",
  "ticket.manage",
  "roadmap.view",
  "roadmap.comment.create",
  "roadmap.manage",
  "users.create",
  "users.edit",
  "users.disable",
  "users.manage_access",
  "role.assign",
  "organization.edit",
  "admin.panel.access",
  "audit.view",
]);

function getDb(env) {
  const db = env.DB || env.D1 || env.MAONO_DB;
  if (!db || typeof db.prepare !== "function") {
    throw apiError("Banco de dados D1 não configurado.", 500, "DATABASE_NOT_CONFIGURED");
  }
  return db;
}

function apiError(message, status, code, extra = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw apiError(`${label} inválido.`, 400, "INVALID_ID");
  }
  return id;
}

function nowIso() {
  return new Date().toISOString();
}

function revisionToken() {
  return globalThis.crypto?.randomUUID?.() ||
    `delegation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function requestId(request) {
  return request?.headers?.get?.("x-request-id") ||
    request?.headers?.get?.("cf-ray") ||
    revisionToken();
}

function changedRows(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function normalizedRole(value) {
  return normalizeRole(value) || String(value || "viewer").trim().toLowerCase();
}

function isSuperAdmin(actor) {
  return normalizedRole(actor?.role) === "super_admin";
}

function actorActiveOrganizationId(actor) {
  return (
    actor?.activeOrganizationId ??
    actor?.active_organization_id ??
    actor?.organizationId ??
    actor?.organization_id ??
    null
  );
}

async function tableExists(env, name) {
  const row = await getDb(env)
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .bind(name)
    .first();
  return Boolean(row?.name);
}

export async function requireAccessGovernanceSchema(env) {
  const required = [
    "organization_access_delegations",
    "delegation_permissions",
    "delegation_target_levels",
  ];
  const availability = await Promise.all(required.map((name) => tableExists(env, name)));
  if (availability.some((value) => !value)) {
    throw apiError(
      "A migration de governança de acessos ainda não foi aplicada.",
      503,
      "ACCESS_GOVERNANCE_MIGRATION_REQUIRED",
    );
  }

  const columnsResult = await getDb(env)
    .prepare("PRAGMA table_info(organization_access_delegations)")
    .all();
  const columns = new Set((columnsResult?.results || []).map((row) => String(row.name)));
  if (!columns.has("justification") || !columns.has("revision_token")) {
    throw apiError(
      "A migration de endurecimento da governança ainda não foi aplicada.",
      503,
      "ACCESS_GOVERNANCE_HARDENING_REQUIRED",
    );
  }
}

async function readUserInOrganization(env, organizationId, userId) {
  return getDb(env)
    .prepare(
      `SELECT
        u.id,
        u.role,
        u.active,
        ou.organization_id,
        ou.access_level
      FROM users u
      INNER JOIN organization_users ou
        ON ou.user_id = u.id
       AND ou.organization_id = ?
      WHERE u.id = ?
      LIMIT 1`,
    )
    .bind(organizationId, userId)
    .first();
}

function eligibleDelegate(row) {
  if (!row || row.active === 0 || row.active === "0") return false;
  return normalizedRole(row.role) === "admin" || String(row.access_level || "").toLowerCase() === "owner";
}

function eligibleTarget(row) {
  if (!row) return false;
  const role = normalizedRole(row.role);
  const accessLevel = String(row.access_level || "").toLowerCase();
  return TARGET_LEVELS.has(accessLevel) && (role === "viewer" || role === "editor");
}

function delegationExpired(row) {
  if (!row?.expires_at) return false;
  const value = new Date(row.expires_at).getTime();
  return !Number.isFinite(value) || value <= Date.now();
}

async function readDelegationRows(env, organizationId, delegateUserId) {
  if (!(await tableExists(env, "organization_access_delegations"))) return null;
  const db = getDb(env);
  const delegation = await db
    .prepare(
      `SELECT *
       FROM organization_access_delegations
       WHERE organization_id = ? AND delegate_user_id = ?
       LIMIT 1`,
    )
    .bind(organizationId, delegateUserId)
    .first();
  if (!delegation) return null;

  const [permissionResult, levelResult] = await Promise.all([
    db
      .prepare(
        `SELECT permission, can_grant, can_revoke
         FROM delegation_permissions
         WHERE delegation_id = ?
         ORDER BY permission`,
      )
      .bind(delegation.id)
      .all(),
    db
      .prepare(
        `SELECT access_level
         FROM delegation_target_levels
         WHERE delegation_id = ?
         ORDER BY access_level`,
      )
      .bind(delegation.id)
      .all(),
  ]);

  return {
    ...delegation,
    permissions: permissionResult?.results || [],
    targetLevels: (levelResult?.results || []).map((row) => row.access_level),
  };
}

function publicDelegation(row) {
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    delegateUserId: row.delegate_user_id,
    enabled: row.enabled === 1 || row.enabled === "1",
    expiresAt: row.expires_at || null,
    expired: delegationExpired(row),
    version: Number(row.version || 1),
    justification: row.justification || "",
    targetLevels: row.targetLevels || [],
    permissions: (row.permissions || []).map((item) => ({
      permission: item.permission,
      canGrant: item.can_grant === 1 || item.can_grant === "1",
      canRevoke: item.can_revoke === 1 || item.can_revoke === "1",
    })),
  };
}

async function ensureOrganizationContext(actor, organizationId) {
  if (isSuperAdmin(actor)) return;
  const activeId = actorActiveOrganizationId(actor);
  if (!activeId || String(activeId) !== String(organizationId)) {
    throw apiError(
      "A organização ativa não corresponde à organização solicitada.",
      403,
      "CROSS_ORGANIZATION_DENIED",
    );
  }
}

export async function getAccessGovernanceCapabilities(env, organizationIdValue, actor) {
  const organizationId = positiveId(organizationIdValue, "organizationId");
  await requireAccessGovernanceSchema(env);
  await ensureOrganizationContext(actor, organizationId);

  if (isSuperAdmin(actor)) {
    return {
      mode: "super_admin",
      organizationId,
      canManageAdditionalAccesses: true,
      canGrant: true,
      canRevoke: true,
      allowedPermissions: [...SUPER_ADMIN_PROJECTS_PERMISSIONS],
      grantPermissions: [...SUPER_ADMIN_PROJECTS_PERMISSIONS],
      revokePermissions: [...SUPER_ADMIN_PROJECTS_PERMISSIONS],
      allowedTargetLevels: ["viewer", "editor", "owner"],
      delegation: null,
      reason: "SUPER_ADMIN",
    };
  }

  const actorRow = await readUserInOrganization(env, organizationId, actor?.id);
  if (!eligibleDelegate(actorRow)) {
    return {
      mode: "organization",
      organizationId,
      canManageAdditionalAccesses: false,
      canGrant: false,
      canRevoke: false,
      allowedPermissions: [],
      grantPermissions: [],
      revokePermissions: [],
      allowedTargetLevels: [],
      delegation: null,
      reason: "DELEGATE_NOT_ELIGIBLE",
    };
  }

  const delegation = await readDelegationRows(env, organizationId, actor.id);
  const enabled = delegation && (delegation.enabled === 1 || delegation.enabled === "1");
  if (!enabled || delegationExpired(delegation)) {
    return {
      mode: "organization",
      organizationId,
      canManageAdditionalAccesses: false,
      canGrant: false,
      canRevoke: false,
      allowedPermissions: [],
      grantPermissions: [],
      revokePermissions: [],
      allowedTargetLevels: [],
      delegation: publicDelegation(delegation),
      reason: delegationExpired(delegation) ? "DELEGATION_EXPIRED" : "DELEGATION_REQUIRED",
    };
  }

  const grantPermissions = [];
  const revokePermissions = [];
  for (const policyItem of delegation.permissions || []) {
    if (!CATALOG_BY_CODE.has(policyItem.permission)) continue;
    const actorDecision = await can(env, actor, policyItem.permission, {
      organizationId,
      scopeType: "organization",
    });
    if (!actorDecision.allowed) continue;
    if (policyItem.can_grant === 1 || policyItem.can_grant === "1") grantPermissions.push(policyItem.permission);
    if (policyItem.can_revoke === 1 || policyItem.can_revoke === "1") revokePermissions.push(policyItem.permission);
  }

  return {
    mode: "organization",
    organizationId,
    canManageAdditionalAccesses: grantPermissions.length > 0 || revokePermissions.length > 0,
    canGrant: grantPermissions.length > 0,
    canRevoke: revokePermissions.length > 0,
    allowedPermissions: Array.from(new Set([...grantPermissions, ...revokePermissions])),
    grantPermissions,
    revokePermissions,
    allowedTargetLevels: (delegation.targetLevels || []).filter((level) => TARGET_LEVELS.has(level)),
    delegation: publicDelegation(delegation),
    reason: "DELEGATION_ACTIVE",
  };
}

async function auditDenied(env, request, actor, organizationId, targetUserId, permission, operation, error, traceId) {
  await recordAuditLog(env, {
    actorUserId: actor?.id,
    organizationId,
    action: "delegated.operation.denied",
    resourceType: "user",
    resourceId: targetUserId,
    result: "denied",
    metadata: {
      permission,
      operation,
      code: error.code,
      reason: error.reason || error.code,
      requestId: traceId,
      policyVersion: error.policyVersion ?? null,
    },
    request,
  });
}

export async function authorizeOrganizationPermissionMutation({
  env,
  request,
  actor,
  organizationId: organizationIdValue,
  targetUserId: targetUserIdValue,
  permission,
  operation,
}) {
  const organizationId = positiveId(organizationIdValue, "organizationId");
  const targetUserId = positiveId(targetUserIdValue, "userId");
  const normalizedPermission = String(permission || "").trim();
  const normalizedOperation = String(operation || "").trim().toLowerCase();
  const traceId = requestId(request);

  try {
    await requireAccessGovernanceSchema(env);
    if (normalizedOperation !== "grant" && normalizedOperation !== "revoke") {
      throw apiError("Operação de acesso inválida.", 400, "INVALID_PERMISSION_OPERATION");
    }
    if (normalizedPermission === ORGANIZATION_ACCESS_DELEGATE_PERMISSION) {
      throw apiError(
        "A delegação deve ser configurada pelo painel obrigatório do Super Admin.",
        403,
        "DELEGATION_MANAGED_SEPARATELY",
      );
    }

    await ensureOrganizationContext(actor, organizationId);
    const target = await readUserInOrganization(env, organizationId, targetUserId);
    if (!target) {
      throw apiError("Usuário não encontrado na organização.", 404, "USER_NOT_FOUND");
    }

    if (isSuperAdmin(actor)) {
      return {
        allowed: true,
        delegated: false,
        reason: "SUPER_ADMIN",
        requestId: traceId,
        policyVersion: null,
        target,
      };
    }

    const actorRow = await readUserInOrganization(env, organizationId, actor?.id);
    if (!eligibleDelegate(actorRow)) {
      throw apiError("Este usuário não é elegível para delegação.", 403, "DELEGATE_NOT_ELIGIBLE");
    }
    if (String(actor.id) === String(targetUserId)) {
      throw apiError("O delegante não pode alterar os próprios acessos.", 403, "SELF_SERVICE_BLOCKED");
    }
    if (!eligibleTarget(target)) {
      throw apiError("A delegação só pode atingir perfis Consulta ou Colaborador.", 403, "TARGET_ROLE_NOT_ALLOWED");
    }

    const catalogItem = CATALOG_BY_CODE.get(normalizedPermission);
    if (!catalogItem?.ownerDelegable) {
      throw apiError("A permissão ultrapassa o teto canônico do owner.", 403, "OWNER_CEILING_EXCEEDED");
    }

    const delegation = await readDelegationRows(env, organizationId, actor.id);
    if (!delegation || !(delegation.enabled === 1 || delegation.enabled === "1")) {
      throw apiError("A delegação de acessos não está ativa.", 403, "DELEGATION_REQUIRED", {
        policyVersion: delegation ? Number(delegation.version) : null,
      });
    }
    if (delegationExpired(delegation)) {
      throw apiError("A delegação de acessos expirou.", 403, "DELEGATION_EXPIRED", {
        policyVersion: Number(delegation.version),
      });
    }
    if (!(delegation.targetLevels || []).includes(String(target.access_level || "").toLowerCase())) {
      throw apiError("O perfil de destino não está autorizado pela política.", 403, "TARGET_ROLE_NOT_ALLOWED");
    }

    const policyItem = (delegation.permissions || []).find((item) => item.permission === normalizedPermission);
    const operationAllowed = normalizedOperation === "grant"
      ? policyItem && (policyItem.can_grant === 1 || policyItem.can_grant === "1")
      : policyItem && (policyItem.can_revoke === 1 || policyItem.can_revoke === "1");
    if (!operationAllowed) {
      throw apiError("A operação não está autorizada pela política de delegação.", 403, "POLICY_PERMISSION_DENIED");
    }

    const actorDecision = await can(env, actor, normalizedPermission, {
      organizationId,
      scopeType: "organization",
    });
    if (!actorDecision.allowed) {
      throw apiError("O delegante não possui a capacidade que tentou atribuir.", 403, "ACTOR_PERMISSION_REQUIRED", {
        reason: actorDecision.reason,
      });
    }

    return {
      allowed: true,
      delegated: true,
      reason: "DELEGATION_ACTIVE",
      requestId: traceId,
      policyVersion: Number(delegation.version),
      target,
      delegation: publicDelegation(delegation),
    };
  } catch (error) {
    await auditDenied(
      env,
      request,
      actor,
      organizationId,
      targetUserId,
      normalizedPermission,
      normalizedOperation,
      error,
      traceId,
    );
    throw error;
  }
}

function normalizePolicyPayload(payload) {
  const targetLevels = Array.from(
    new Set((Array.isArray(payload?.targetLevels) ? payload.targetLevels : []).map((value) => String(value).toLowerCase())),
  );
  if (targetLevels.length === 0 || targetLevels.some((level) => !TARGET_LEVELS.has(level))) {
    throw apiError("Selecione ao menos um perfil de destino válido.", 400, "INVALID_TARGET_LEVELS");
  }

  const permissions = (Array.isArray(payload?.permissions) ? payload.permissions : []).map((item) => ({
    permission: String(item?.permission || "").trim(),
    canGrant: item?.canGrant === true,
    canRevoke: item?.canRevoke === true,
  }));
  if (permissions.length === 0) {
    throw apiError("Selecione ao menos um acesso permitido.", 400, "INVALID_DELEGATION_PERMISSIONS");
  }
  const seen = new Set();
  for (const item of permissions) {
    if (!CATALOG_BY_CODE.has(item.permission)) {
      throw apiError("A política contém uma permissão fora do teto do owner.", 400, "OWNER_CEILING_EXCEEDED");
    }
    if (!item.canGrant && !item.canRevoke) {
      throw apiError("Cada acesso precisa permitir concessão, revogação ou ambas.", 400, "INVALID_DELEGATION_OPERATION");
    }
    if (seen.has(item.permission)) {
      throw apiError("A política contém permissões duplicadas.", 400, "DUPLICATE_DELEGATION_PERMISSION");
    }
    seen.add(item.permission);
  }

  const expiresAt = payload?.expiresAt ? new Date(payload.expiresAt) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
    throw apiError("A expiração deve estar no futuro.", 400, "INVALID_EXPIRATION");
  }

  const version = payload?.version === undefined || payload?.version === null
    ? null
    : Number(payload.version);
  if (version !== null && (!Number.isInteger(version) || version < 1)) {
    throw apiError("Versão da política inválida.", 400, "INVALID_POLICY_VERSION");
  }

  const justification = String(payload?.justification || "").trim();
  if (justification.length < 5 || justification.length > 500) {
    throw apiError(
      "Informe uma justificativa entre 5 e 500 caracteres.",
      400,
      "DELEGATION_JUSTIFICATION_REQUIRED",
    );
  }
  if (payload?.confirmed !== true) {
    throw apiError(
      "Confirme a revisão do escopo antes de salvar.",
      400,
      "DELEGATION_CONFIRMATION_REQUIRED",
    );
  }

  return {
    targetLevels,
    permissions,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    version,
    justification,
  };
}

export async function getDelegationPolicy(env, organizationIdValue, delegateUserIdValue) {
  const organizationId = positiveId(organizationIdValue, "organizationId");
  const delegateUserId = positiveId(delegateUserIdValue, "userId");
  await requireAccessGovernanceSchema(env);
  return {
    catalog: DELEGATION_POLICY_CATALOG,
    delegation: publicDelegation(await readDelegationRows(env, organizationId, delegateUserId)),
  };
}

export async function saveDelegationPolicy(env, organizationIdValue, delegateUserIdValue, payload, actor, request) {
  if (!isSuperAdmin(actor)) {
    throw apiError("Somente Super Admin pode configurar delegações.", 403, "SUPER_ADMIN_REQUIRED");
  }
  const organizationId = positiveId(organizationIdValue, "organizationId");
  const delegateUserId = positiveId(delegateUserIdValue, "userId");
  await requireAccessGovernanceSchema(env);
  const normalized = normalizePolicyPayload(payload);
  const delegate = await readUserInOrganization(env, organizationId, delegateUserId);
  if (!eligibleDelegate(delegate)) {
    throw apiError("A delegação só pode ser concedida a owner ou admin ativo da organização.", 409, "DELEGATE_NOT_ELIGIBLE");
  }

  const db = getDb(env);
  let existing = await readDelegationRows(env, organizationId, delegateUserId);
  let seeded = false;
  if (existing) {
    if (normalized.version === null || Number(existing.version) !== normalized.version) {
      throw apiError("A política foi alterada por outra sessão.", 409, "POLICY_VERSION_CONFLICT", {
        policyVersion: Number(existing.version),
      });
    }
  } else {
    if (normalized.version !== null) {
      throw apiError("A política foi criada por outra sessão.", 409, "POLICY_VERSION_CONFLICT", {
        policyVersion: 0,
      });
    }
    const now = nowIso();
    try {
      const seed = await db
        .prepare(
          `INSERT INTO organization_access_delegations
            (organization_id, delegate_user_id, enabled, expires_at, version,
             justification, revision_token, granted_by, updated_by, created_at, updated_at)
           VALUES (?, ?, 0, NULL, 1, '', ?, ?, ?, ?, ?)`,
        )
        .bind(organizationId, delegateUserId, revisionToken(), actor.id, actor.id, now, now)
        .run();
      if (changedRows(seed) !== 1) {
        throw apiError("A política foi criada por outra sessão.", 409, "POLICY_VERSION_CONFLICT");
      }
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(String(error?.message || ""))) {
        const concurrent = await readDelegationRows(env, organizationId, delegateUserId);
        throw apiError("A política foi criada por outra sessão.", 409, "POLICY_VERSION_CONFLICT", {
          policyVersion: Number(concurrent?.version || 0),
        });
      }
      throw error;
    }
    existing = await readDelegationRows(env, organizationId, delegateUserId);
    seeded = true;
  }

  const expectedVersion = Number(existing.version);
  const nextVersion = seeded ? expectedVersion : expectedVersion + 1;
  const now = nowIso();
  const token = revisionToken();
  const guard = `EXISTS (
    SELECT 1 FROM organization_access_delegations
    WHERE id = ? AND version = ? AND revision_token = ?
  )`;
  const statements = [
    db
      .prepare(
        `UPDATE organization_access_delegations
         SET enabled = 1, expires_at = ?, version = ?, justification = ?,
             revision_token = ?, updated_by = ?, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .bind(
        normalized.expiresAt,
        nextVersion,
        normalized.justification,
        token,
        actor.id,
        now,
        existing.id,
        expectedVersion,
      ),
    db
      .prepare(`DELETE FROM delegation_permissions WHERE delegation_id = ? AND ${guard}`)
      .bind(existing.id, existing.id, nextVersion, token),
    db
      .prepare(`DELETE FROM delegation_target_levels WHERE delegation_id = ? AND ${guard}`)
      .bind(existing.id, existing.id, nextVersion, token),
  ];
  for (const item of normalized.permissions) {
    statements.push(
      db
        .prepare(
          `INSERT INTO delegation_permissions
            (delegation_id, permission, can_grant, can_revoke, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE ${guard}`,
        )
        .bind(
          existing.id,
          item.permission,
          item.canGrant ? 1 : 0,
          item.canRevoke ? 1 : 0,
          now,
          now,
          existing.id,
          nextVersion,
          token,
        ),
    );
  }
  for (const accessLevel of normalized.targetLevels) {
    statements.push(
      db
        .prepare(
          `INSERT INTO delegation_target_levels (delegation_id, access_level, created_at)
           SELECT ?, ?, ?
           WHERE ${guard}`,
        )
        .bind(existing.id, accessLevel, now, existing.id, nextVersion, token),
    );
  }

  const results = await db.batch(statements);
  if (changedRows(results?.[0]) !== 1) {
    const concurrent = await readDelegationRows(env, organizationId, delegateUserId);
    throw apiError("A política foi alterada por outra sessão.", 409, "POLICY_VERSION_CONFLICT", {
      policyVersion: Number(concurrent?.version || 0),
    });
  }

  const traceId = requestId(request);
  await recordAuditLog(env, {
    actorUserId: actor.id,
    organizationId,
    action: existing.enabled ? "delegation.policy.update" : "delegation.policy.create",
    resourceType: "user",
    resourceId: delegateUserId,
    metadata: {
      requestId: traceId,
      policyVersion: nextVersion,
      targetLevels: normalized.targetLevels,
      permissions: normalized.permissions,
      expiresAt: normalized.expiresAt,
      justification: normalized.justification,
      confirmed: true,
    },
    request,
  });

  return publicDelegation(await readDelegationRows(env, organizationId, delegateUserId));
}

export async function disableDelegationPolicy(
  env,
  organizationIdValue,
  delegateUserIdValue,
  expectedVersionValue,
  actor,
  request,
) {
  if (!isSuperAdmin(actor)) {
    throw apiError("Somente Super Admin pode revogar delegações.", 403, "SUPER_ADMIN_REQUIRED");
  }
  const organizationId = positiveId(organizationIdValue, "organizationId");
  const delegateUserId = positiveId(delegateUserIdValue, "userId");
  const expectedVersion = Number(expectedVersionValue);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw apiError("Versão da política inválida.", 400, "INVALID_POLICY_VERSION");
  }
  await requireAccessGovernanceSchema(env);
  const existing = await readDelegationRows(env, organizationId, delegateUserId);
  if (!existing) return null;
  if (Number(existing.version) !== expectedVersion) {
    throw apiError("A política foi alterada por outra sessão.", 409, "POLICY_VERSION_CONFLICT", {
      policyVersion: Number(existing.version),
    });
  }
  const nextVersion = expectedVersion + 1;
  const result = await getDb(env)
    .prepare(
      `UPDATE organization_access_delegations
       SET enabled = 0, version = ?, revision_token = ?, updated_by = ?, updated_at = ?
       WHERE id = ? AND version = ?`,
    )
    .bind(nextVersion, revisionToken(), actor.id, nowIso(), existing.id, expectedVersion)
    .run();
  if (changedRows(result) !== 1) {
    const concurrent = await readDelegationRows(env, organizationId, delegateUserId);
    throw apiError("A política foi alterada por outra sessão.", 409, "POLICY_VERSION_CONFLICT", {
      policyVersion: Number(concurrent?.version || 0),
    });
  }

  await recordAuditLog(env, {
    actorUserId: actor.id,
    organizationId,
    action: "delegation.policy.disable",
    resourceType: "user",
    resourceId: delegateUserId,
    metadata: {
      requestId: requestId(request),
      policyVersion: nextVersion,
      previousVersion: expectedVersion,
    },
    request,
  });
  return publicDelegation(await readDelegationRows(env, organizationId, delegateUserId));
}
