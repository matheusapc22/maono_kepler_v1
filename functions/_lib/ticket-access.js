const REQUIRED_TABLES = Object.freeze([
  "ticket_access_groups",
  "ticket_access_group_members",
  "ticket_access_policies",
  "ticket_access_policy_entries",
  "ticket_ticket_access_policies",
  "ticket_acl_entries",
  "ticket_labels",
  "ticket_label_links",
]);

const ACTIONS = new Set(["ticket.view", "ticket.comment", "ticket.manage"]);
const EFFECTS = new Set(["allow", "deny"]);
const PRINCIPAL_TYPES = new Set(["user", "group"]);
const VISIBILITIES = new Set(["organization", "private"]);

function getDb(env) {
  const db = env?.DB || env?.D1 || env?.MAONO_DB;
  if (!db || typeof db.prepare !== "function") {
    throw accessError("Banco de dados D1 não configurado.", 500, "DATABASE_NOT_CONFIGURED");
  }
  return db;
}

function accessError(message, status = 400, code = "TICKET_ACCESS_INVALID", details = undefined) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function cleanText(value, label, { required = false, max = 160 } = {}) {
  const text = String(value ?? "").trim();
  if (required && !text) throw accessError(`${label} é obrigatório.`, 400, "TICKET_ACCESS_FIELD_REQUIRED");
  if (text.length > max) throw accessError(`${label} excede ${max} caracteres.`, 400, "TICKET_ACCESS_FIELD_TOO_LONG");
  return text;
}

function normalizeId(value, label = "Identificador") {
  const id = String(value ?? "").trim();
  if (!id || id.length > 120) throw accessError(`${label} inválido.`, 400, "TICKET_ACCESS_ID_INVALID");
  return id;
}

function normalizePositiveInteger(value, label = "Identificador") {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw accessError(`${label} inválido.`, 400, "TICKET_ACCESS_ID_INVALID");
  return number;
}

function normalizeVisibility(value) {
  const visibility = String(value || "organization").trim().toLowerCase();
  if (!VISIBILITIES.has(visibility)) throw accessError("Visibilidade de chamado inválida.", 400, "TICKET_VISIBILITY_INVALID");
  return visibility;
}

function normalizeAction(value) {
  const action = String(value || "").trim();
  if (!ACTIONS.has(action)) throw accessError("Ação de acesso inválida.", 400, "TICKET_ACCESS_ACTION_INVALID");
  return action;
}

function normalizeEffect(value) {
  const effect = String(value || "").trim().toLowerCase();
  if (!EFFECTS.has(effect)) throw accessError("Efeito de acesso inválido.", 400, "TICKET_ACCESS_EFFECT_INVALID");
  return effect;
}

function normalizePrincipalType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!PRINCIPAL_TYPES.has(type)) throw accessError("Tipo de principal inválido.", 400, "TICKET_ACCESS_PRINCIPAL_TYPE_INVALID");
  return type;
}

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${value}`;
}

async function tableColumns(env, table) {
  const result = await getDb(env).prepare(`PRAGMA table_info(${table})`).all();
  return new Set((result?.results || []).map((row) => String(row.name)));
}

async function existingTables(env) {
  const placeholders = REQUIRED_TABLES.map(() => "?").join(",");
  const result = await getDb(env)
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
    .bind(...REQUIRED_TABLES)
    .all();
  return new Set((result?.results || []).map((row) => String(row.name)));
}

export function isTicketSelectiveAccessEnabled(env) {
  return String(env?.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED || "").trim().toLowerCase() === "true";
}

export async function getTicketSelectiveAccessCapability(env) {
  if (!isTicketSelectiveAccessEnabled(env)) return false;
  const columns = await tableColumns(env, "organization_tickets");
  if (!columns.has("visibility")) return false;
  const tables = await existingTables(env);
  return REQUIRED_TABLES.every((table) => tables.has(table));
}

export async function assertTicketSelectiveAccessReady(env) {
  if (!isTicketSelectiveAccessEnabled(env)) {
    throw accessError(
      "O acesso seletivo de chamados ainda não está habilitado neste ambiente.",
      503,
      "TICKET_SELECTIVE_ACCESS_DISABLED",
    );
  }
  if (!(await getTicketSelectiveAccessCapability(env))) {
    throw accessError(
      "O acesso seletivo de chamados está temporariamente indisponível porque o schema necessário não foi confirmado.",
      503,
      "TICKET_SELECTIVE_ACCESS_SCHEMA_OUTDATED",
    );
  }
  return true;
}

async function actorContext(env, organizationId, user) {
  if (!user?.id) return { activeMember: false, groupIds: [] };
  const member = await getDb(env)
    .prepare(`SELECT 1 AS ok
      FROM organization_users ou
      INNER JOIN users u ON u.id = ou.user_id
      WHERE ou.organization_id = ? AND ou.user_id = ? AND u.active = 1
      LIMIT 1`)
    .bind(organizationId, user.id)
    .first();
  if (!member?.ok) return { activeMember: false, groupIds: [] };
  const groups = await getDb(env)
    .prepare(`SELECT gm.group_id
      FROM ticket_access_group_members gm
      INNER JOIN ticket_access_groups g
        ON g.id = gm.group_id AND g.organization_id = gm.organization_id
      WHERE gm.organization_id = ? AND gm.user_id = ? AND g.active = 1`)
    .bind(organizationId, user.id)
    .all();
  return {
    activeMember: true,
    groupIds: (groups?.results || []).map((row) => String(row.group_id)),
  };
}

function principalMatch(alias, userId, groupIds) {
  const clauses = [`(${alias}.principal_type = 'user' AND ${alias}.principal_id = ?)`];
  const values = [String(userId)];
  if (groupIds.length) {
    clauses.push(`(${alias}.principal_type = 'group' AND ${alias}.principal_id IN (${groupIds.map(() => "?").join(",")}))`);
    values.push(...groupIds);
  }
  return { sql: `(${clauses.join(" OR ")})`, values };
}

function actionSets(action) {
  const normalized = normalizeAction(action);
  if (normalized === "ticket.view") {
    return { action: normalized, allows: ["ticket.view", "ticket.manage"], denies: ["ticket.view"] };
  }
  if (normalized === "ticket.comment") {
    return { action: normalized, allows: ["ticket.comment", "ticket.manage"], denies: ["ticket.view", "ticket.comment"] };
  }
  return { action: normalized, allows: ["ticket.manage"], denies: ["ticket.view", "ticket.manage"] };
}

function inClause(values) {
  return values.map(() => "?").join(",");
}

function aclExistsSql({ effect, actions, principal }) {
  return {
    sql: `EXISTS (
      SELECT 1 FROM ticket_acl_entries ae
      WHERE ae.organization_id = t.organization_id
        AND ae.ticket_id = t.id
        AND ae.effect = ?
        AND ae.action IN (${inClause(actions)})
        AND ${principal.sql}
    )`,
    values: [effect, ...actions, ...principal.values],
  };
}

function policyExistsSql({ effect, actions, principal }) {
  return {
    sql: `EXISTS (
      SELECT 1
      FROM ticket_ticket_access_policies tp
      INNER JOIN ticket_access_policies p
        ON p.id = tp.policy_id AND p.organization_id = tp.organization_id AND p.active = 1
      INNER JOIN ticket_access_policy_entries pe
        ON pe.policy_id = p.id AND pe.organization_id = p.organization_id
      WHERE tp.organization_id = t.organization_id
        AND tp.ticket_id = t.id
        AND pe.effect = ?
        AND pe.action IN (${inClause(actions)})
        AND ${principal.sql.replaceAll("ae.", "pe.")}
    )`,
    values: [effect, ...actions, ...principal.values],
  };
}

export async function buildTicketAccessPredicate(env, organizationId, user, action = "ticket.view") {
  if (!isTicketSelectiveAccessEnabled(env)) return { sql: "1 = 1", values: [], selective: false };
  await assertTicketSelectiveAccessReady(env);
  const actor = await actorContext(env, organizationId, user);
  if (!actor.activeMember) {
    return { sql: "COALESCE(t.visibility, 'organization') = 'organization'", values: [], selective: true };
  }
  const sets = actionSets(action);
  const principal = principalMatch("ae", user.id, actor.groupIds);
  const aclDeny = aclExistsSql({ effect: "deny", actions: sets.denies, principal });
  const policyDeny = policyExistsSql({ effect: "deny", actions: sets.denies, principal });
  const aclAllow = aclExistsSql({ effect: "allow", actions: sets.allows, principal });
  const policyAllow = policyExistsSql({ effect: "allow", actions: sets.allows, principal });
  const actionAllowSql = `((${aclAllow.sql}) OR (${policyAllow.sql}))`;
  const values = [...aclDeny.values, ...policyDeny.values, ...aclAllow.values, ...policyAllow.values];
  let requiredAllowSql = actionAllowSql;
  if (sets.action === "ticket.comment") {
    // Commenting depends on being able to read the object. A comment-only grant
    // must not become a side-channel that bypasses ticket.view.
    const viewAclAllow = aclExistsSql({ effect: "allow", actions: ["ticket.view", "ticket.manage"], principal });
    const viewPolicyAllow = policyExistsSql({ effect: "allow", actions: ["ticket.view", "ticket.manage"], principal });
    requiredAllowSql = `${actionAllowSql} AND ((${viewAclAllow.sql}) OR (${viewPolicyAllow.sql}))`;
    values.push(...viewAclAllow.values, ...viewPolicyAllow.values);
  }
  return {
    selective: true,
    sql: `(COALESCE(t.visibility, 'organization') = 'organization' OR (
      t.visibility = 'private'
      AND NOT (${aclDeny.sql})
      AND NOT (${policyDeny.sql})
      AND (${requiredAllowSql})
    ))`,
    values,
  };
}

export async function requireTicketAccess(env, organizationId, ticketId, user, action = "ticket.view") {
  const predicate = await buildTicketAccessPredicate(env, organizationId, user, action);
  // Flag OFF must remain compatible with a database where migration 0027 has
  // not been applied. Do not reference visibility or any CC-04 table unless
  // the selective-access capability is active.
  if (!predicate.selective) {
    const row = await getDb(env)
      .prepare(`SELECT t.id, t.organization_id
        FROM organization_tickets t
        WHERE t.organization_id = ? AND t.id = ? AND t.active = 1
        LIMIT 1`)
      .bind(organizationId, ticketId)
      .first();
    if (!row) throw accessError("Chamado não encontrado.", 404, "TICKET_NOT_FOUND");
    return { ticket: { ...row, visibility: "organization" }, selective: false };
  }

  const row = await getDb(env)
    .prepare(`SELECT t.id, t.organization_id, COALESCE(t.visibility, 'organization') AS visibility
      FROM organization_tickets t
      WHERE t.organization_id = ? AND t.id = ? AND t.active = 1 AND (${predicate.sql})
      LIMIT 1`)
    .bind(organizationId, ticketId, ...predicate.values)
    .first();
  if (!row) {
    throw accessError("Chamado não encontrado.", 404, "TICKET_NOT_FOUND");
  }
  return { ticket: row, selective: true };
}

async function requireTicketExistsForAdmin(env, organizationId, ticketId) {
  const row = await getDb(env)
    .prepare(`SELECT id, organization_id, COALESCE(visibility, 'organization') AS visibility, version
      FROM organization_tickets
      WHERE organization_id = ? AND id = ? AND active = 1 LIMIT 1`)
    .bind(organizationId, ticketId)
    .first();
  if (!row) throw accessError("Chamado não encontrado.", 404, "TICKET_NOT_FOUND");
  return row;
}

async function validateUserPrincipal(env, organizationId, userId) {
  const id = normalizePositiveInteger(userId, "Usuário");
  const row = await getDb(env)
    .prepare(`SELECT u.id
      FROM organization_users ou
      INNER JOIN users u ON u.id = ou.user_id
      WHERE ou.organization_id = ? AND ou.user_id = ? AND u.active = 1
      LIMIT 1`)
    .bind(organizationId, id)
    .first();
  if (!row?.id) throw accessError("O usuário informado não é membro ativo desta organização.", 400, "TICKET_ACCESS_USER_SCOPE_INVALID");
  return String(id);
}

async function validateGroupPrincipal(env, organizationId, groupId) {
  const id = normalizeId(groupId, "Grupo");
  const row = await getDb(env)
    .prepare(`SELECT id FROM ticket_access_groups WHERE id = ? AND organization_id = ? AND active = 1 LIMIT 1`)
    .bind(id, organizationId)
    .first();
  if (!row?.id) throw accessError("O grupo informado não pertence a esta organização ou está inativo.", 400, "TICKET_ACCESS_GROUP_SCOPE_INVALID");
  return id;
}

async function validatePrincipal(env, organizationId, entry) {
  const principalType = normalizePrincipalType(entry?.principalType ?? entry?.principal_type);
  const rawId = entry?.principalId ?? entry?.principal_id;
  const principalId = principalType === "user"
    ? await validateUserPrincipal(env, organizationId, rawId)
    : await validateGroupPrincipal(env, organizationId, rawId);
  return {
    principalType,
    principalId,
    action: normalizeAction(entry?.action),
    effect: normalizeEffect(entry?.effect),
  };
}

async function validateMembers(env, organizationId, members) {
  if (!Array.isArray(members)) throw accessError("A lista de membros deve ser um array.");
  const ids = [...new Set(members.map((value) => normalizePositiveInteger(value, "Membro")))];
  for (const id of ids) await validateUserPrincipal(env, organizationId, id);
  return ids;
}

function publicGroup(row, members = []) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description || "",
    active: Boolean(row.active),
    memberCount: Number(row.member_count ?? members.length ?? 0),
    members,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function ticketAccessGroupMembers(env, organizationId, groupId) {
  const result = await getDb(env).prepare(`SELECT u.id, u.name, u.email
    FROM ticket_access_group_members gm
    INNER JOIN users u ON u.id = gm.user_id
    WHERE gm.organization_id = ? AND gm.group_id = ? AND u.active = 1
    ORDER BY COALESCE(u.name, u.email), u.id`).bind(organizationId, groupId).all();
  return (result?.results || []).map((row) => ({ id: Number(row.id), name: row.name || row.email || "Usuário", email: row.email || null }));
}

export async function listTicketAccessGroups(env, organizationId) {
  await assertTicketSelectiveAccessReady(env);
  const result = await getDb(env).prepare(`SELECT g.*,
      (SELECT COUNT(*) FROM ticket_access_group_members gm WHERE gm.group_id = g.id AND gm.organization_id = g.organization_id) AS member_count
    FROM ticket_access_groups g WHERE g.organization_id = ? ORDER BY g.active DESC, LOWER(g.name), g.id`).bind(organizationId).all();
  const output = [];
  for (const row of result?.results || []) output.push(publicGroup(row, await ticketAccessGroupMembers(env, organizationId, row.id)));
  return output;
}

export async function createTicketAccessGroup(env, organizationId, payload, actorId) {
  await assertTicketSelectiveAccessReady(env);
  const name = cleanText(payload?.name, "Nome do grupo", { required: true, max: 120 });
  const description = cleanText(payload?.description, "Descrição", { max: 500 });
  const members = await validateMembers(env, organizationId, payload?.members || []);
  const id = randomId("tagrp");
  const now = nowIso();
  const statements = [
    getDb(env).prepare(`INSERT INTO ticket_access_groups
      (id, organization_id, name, description, active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)`).bind(id, organizationId, name, description, actorId, now, now),
    ...members.map((userId) => getDb(env).prepare(`INSERT INTO ticket_access_group_members
      (group_id, organization_id, user_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, organizationId, userId, actorId, now)),
  ];
  await getDb(env).batch(statements);
  return publicGroup({ id, organization_id: organizationId, name, description, active: 1, member_count: members.length, created_at: now, updated_at: now }, await ticketAccessGroupMembers(env, organizationId, id));
}

export async function updateTicketAccessGroup(env, organizationId, groupId, payload, actorId) {
  await assertTicketSelectiveAccessReady(env);
  const id = normalizeId(groupId, "Grupo");
  const current = await getDb(env).prepare(`SELECT * FROM ticket_access_groups WHERE id = ? AND organization_id = ? LIMIT 1`).bind(id, organizationId).first();
  if (!current?.id) throw accessError("Grupo de acesso não encontrado.", 404, "TICKET_ACCESS_GROUP_NOT_FOUND");
  const name = payload?.name === undefined ? current.name : cleanText(payload.name, "Nome do grupo", { required: true, max: 120 });
  const description = payload?.description === undefined ? current.description || "" : cleanText(payload.description, "Descrição", { max: 500 });
  const active = payload?.active === undefined ? Number(current.active) : (payload.active ? 1 : 0);
  const members = payload?.members === undefined ? null : await validateMembers(env, organizationId, payload.members);
  const now = nowIso();
  const statements = [getDb(env).prepare(`UPDATE ticket_access_groups SET name = ?, description = ?, active = ?, updated_at = ? WHERE id = ? AND organization_id = ?`).bind(name, description, active, now, id, organizationId)];
  if (members) {
    statements.push(getDb(env).prepare(`DELETE FROM ticket_access_group_members WHERE group_id = ? AND organization_id = ?`).bind(id, organizationId));
    for (const userId of members) statements.push(getDb(env).prepare(`INSERT INTO ticket_access_group_members (group_id, organization_id, user_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)`).bind(id, organizationId, userId, actorId, now));
  }
  await getDb(env).batch(statements);
  const memberCount = members ? members.length : Number((await getDb(env).prepare(`SELECT COUNT(*) AS total FROM ticket_access_group_members WHERE group_id = ? AND organization_id = ?`).bind(id, organizationId).first())?.total || 0);
  return publicGroup({ ...current, name, description, active, member_count: memberCount, updated_at: now }, await ticketAccessGroupMembers(env, organizationId, id));
}

function publicPolicy(row, entries = []) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description || "",
    active: Boolean(row.active),
    entries,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function normalizeEntries(env, organizationId, entries) {
  if (!Array.isArray(entries)) throw accessError("As regras da política devem ser um array.");
  const normalized = [];
  const seen = new Set();
  for (const entry of entries) {
    const value = await validatePrincipal(env, organizationId, entry);
    const key = `${value.principalType}:${value.principalId}:${value.action}`;
    if (seen.has(key)) throw accessError("Uma política não pode repetir o mesmo principal e ação.", 400, "TICKET_ACCESS_POLICY_DUPLICATE_ENTRY");
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

async function policyEntries(env, organizationId, policyId) {
  const result = await getDb(env).prepare(`SELECT principal_type, principal_id, action, effect
    FROM ticket_access_policy_entries WHERE organization_id = ? AND policy_id = ?
    ORDER BY principal_type, principal_id, action`).bind(organizationId, policyId).all();
  return (result?.results || []).map((row) => ({ principalType: row.principal_type, principalId: row.principal_id, action: row.action, effect: row.effect }));
}

export async function listTicketAccessPolicies(env, organizationId) {
  await assertTicketSelectiveAccessReady(env);
  const result = await getDb(env).prepare(`SELECT * FROM ticket_access_policies WHERE organization_id = ? ORDER BY active DESC, LOWER(name), id`).bind(organizationId).all();
  const output = [];
  for (const row of result?.results || []) output.push(publicPolicy(row, await policyEntries(env, organizationId, row.id)));
  return output;
}

export async function createTicketAccessPolicy(env, organizationId, payload, actorId) {
  await assertTicketSelectiveAccessReady(env);
  const name = cleanText(payload?.name, "Nome da política", { required: true, max: 120 });
  const description = cleanText(payload?.description, "Descrição", { max: 500 });
  const entries = await normalizeEntries(env, organizationId, payload?.entries || []);
  const id = randomId("tapol");
  const now = nowIso();
  const statements = [getDb(env).prepare(`INSERT INTO ticket_access_policies
    (id, organization_id, name, description, active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)`).bind(id, organizationId, name, description, actorId, now, now)];
  for (const entry of entries) statements.push(getDb(env).prepare(`INSERT INTO ticket_access_policy_entries
    (policy_id, organization_id, principal_type, principal_id, action, effect, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, organizationId, entry.principalType, entry.principalId, entry.action, entry.effect, actorId, now));
  await getDb(env).batch(statements);
  return publicPolicy({ id, organization_id: organizationId, name, description, active: 1, created_at: now, updated_at: now }, entries);
}

export async function updateTicketAccessPolicy(env, organizationId, policyId, payload, actorId) {
  await assertTicketSelectiveAccessReady(env);
  const id = normalizeId(policyId, "Política");
  const current = await getDb(env).prepare(`SELECT * FROM ticket_access_policies WHERE id = ? AND organization_id = ? LIMIT 1`).bind(id, organizationId).first();
  if (!current?.id) throw accessError("Política de acesso não encontrada.", 404, "TICKET_ACCESS_POLICY_NOT_FOUND");
  const name = payload?.name === undefined ? current.name : cleanText(payload.name, "Nome da política", { required: true, max: 120 });
  const description = payload?.description === undefined ? current.description || "" : cleanText(payload.description, "Descrição", { max: 500 });
  const active = payload?.active === undefined ? Number(current.active) : (payload.active ? 1 : 0);
  const entries = payload?.entries === undefined ? null : await normalizeEntries(env, organizationId, payload.entries);
  const now = nowIso();
  const statements = [getDb(env).prepare(`UPDATE ticket_access_policies SET name = ?, description = ?, active = ?, updated_at = ? WHERE id = ? AND organization_id = ?`).bind(name, description, active, now, id, organizationId)];
  if (entries) {
    statements.push(getDb(env).prepare(`DELETE FROM ticket_access_policy_entries WHERE policy_id = ? AND organization_id = ?`).bind(id, organizationId));
    for (const entry of entries) statements.push(getDb(env).prepare(`INSERT INTO ticket_access_policy_entries
      (policy_id, organization_id, principal_type, principal_id, action, effect, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, organizationId, entry.principalType, entry.principalId, entry.action, entry.effect, actorId, now));
  }
  await getDb(env).batch(statements);
  return publicPolicy({ ...current, name, description, active, updated_at: now }, entries || await policyEntries(env, organizationId, id));
}

export async function getTicketAccessConfiguration(env, organizationId, ticketId) {
  await assertTicketSelectiveAccessReady(env);
  const ticket = await requireTicketExistsForAdmin(env, organizationId, ticketId);
  const [acl, policies] = await Promise.all([
    getDb(env).prepare(`SELECT principal_type, principal_id, action, effect FROM ticket_acl_entries
      WHERE organization_id = ? AND ticket_id = ? ORDER BY principal_type, principal_id, action`).bind(organizationId, ticketId).all(),
    getDb(env).prepare(`SELECT p.id, p.name, p.description, p.active FROM ticket_ticket_access_policies tp
      INNER JOIN ticket_access_policies p ON p.id = tp.policy_id AND p.organization_id = tp.organization_id
      WHERE tp.organization_id = ? AND tp.ticket_id = ? ORDER BY LOWER(p.name), p.id`).bind(organizationId, ticketId).all(),
  ]);
  return {
    visibility: normalizeVisibility(ticket.visibility),
    acl: (acl?.results || []).map((row) => ({ principalType: row.principal_type, principalId: row.principal_id, action: row.action, effect: row.effect })),
    policies: (policies?.results || []).map((row) => ({ id: row.id, name: row.name, description: row.description || "", active: Boolean(row.active) })),
  };
}

async function validatePolicyIds(env, organizationId, rawPolicyIds) {
  if (!Array.isArray(rawPolicyIds)) throw accessError("A lista de políticas deve ser um array.");
  const ids = [...new Set(rawPolicyIds.map((id) => normalizeId(id, "Política")))];
  for (const id of ids) {
    const row = await getDb(env).prepare(`SELECT id FROM ticket_access_policies WHERE id = ? AND organization_id = ? AND active = 1 LIMIT 1`).bind(id, organizationId).first();
    if (!row?.id) throw accessError("Uma política informada não pertence a esta organização ou está inativa.", 400, "TICKET_ACCESS_POLICY_SCOPE_INVALID");
  }
  return ids;
}

async function hasPolicyAllow(env, organizationId, policyIds) {
  if (!policyIds.length) return false;
  const row = await getDb(env).prepare(`SELECT 1 AS ok FROM ticket_access_policy_entries
    WHERE organization_id = ? AND policy_id IN (${policyIds.map(() => "?").join(",")})
      AND effect = 'allow' AND action IN ('ticket.view','ticket.manage') LIMIT 1`)
    .bind(organizationId, ...policyIds).first();
  return Boolean(row?.ok);
}

export async function replaceTicketAccessConfiguration(env, organizationId, ticketId, payload, actorId) {
  await assertTicketSelectiveAccessReady(env);
  const ticket = await requireTicketExistsForAdmin(env, organizationId, ticketId);
  const visibility = normalizeVisibility(payload?.visibility);
  const rawAcl = payload?.acl || [];
  if (!Array.isArray(rawAcl)) throw accessError("A ACL do chamado deve ser um array.");
  const acl = [];
  const seen = new Set();
  for (const entry of rawAcl) {
    const normalized = await validatePrincipal(env, organizationId, entry);
    const key = `${normalized.principalType}:${normalized.principalId}:${normalized.action}`;
    if (seen.has(key)) throw accessError("A ACL não pode repetir o mesmo principal e ação.", 400, "TICKET_ACCESS_DUPLICATE_ENTRY");
    seen.add(key);
    acl.push(normalized);
  }
  const policyIds = await validatePolicyIds(env, organizationId, payload?.policyIds || []);
  if (visibility === "private") {
    const directAllow = acl.some((entry) =>
      entry.effect === "allow" && (entry.action === "ticket.view" || entry.action === "ticket.manage"));
    if (!directAllow && !(await hasPolicyAllow(env, organizationId, policyIds))) {
      throw accessError("Um chamado privado precisa manter pelo menos um caminho explícito de acesso.", 400, "TICKET_PRIVATE_WITHOUT_ALLOW");
    }
  }
  const now = nowIso();
  const db = getDb(env);
  const eventMetadata = JSON.stringify({ visibility, acl, policyIds });
  const statements = [
    db.prepare(`UPDATE organization_tickets SET visibility = ?, version = version + 1, last_command_id = NULL, updated_at = ?
      WHERE id = ? AND organization_id = ? AND active = 1`).bind(visibility, now, ticketId, organizationId),
    db.prepare(`DELETE FROM ticket_acl_entries WHERE organization_id = ? AND ticket_id = ?`).bind(organizationId, ticketId),
    ...acl.map((entry) => db.prepare(`INSERT INTO ticket_acl_entries
      (organization_id, ticket_id, principal_type, principal_id, action, effect, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(organizationId, ticketId, entry.principalType, entry.principalId, entry.action, entry.effect, actorId, now)),
    db.prepare(`DELETE FROM ticket_ticket_access_policies WHERE organization_id = ? AND ticket_id = ?`).bind(organizationId, ticketId),
    ...policyIds.map((policyId) => db.prepare(`INSERT INTO ticket_ticket_access_policies
      (organization_id, ticket_id, policy_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(organizationId, ticketId, policyId, actorId, now)),
    db.prepare(`INSERT INTO ticket_events
      (organization_id, ticket_id, event_type, actor_user_id, metadata, created_at, entity_version)
      SELECT organization_id, id, 'ticket.access.changed', ?, ?, ?, version
      FROM organization_tickets WHERE organization_id = ? AND id = ? AND active = 1`)
      .bind(actorId, eventMetadata, now, organizationId, ticketId),
  ];
  await db.batch(statements);
  return getTicketAccessConfiguration(env, organizationId, ticketId);
}

function readLabelsJson(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function publicTicketLabels(row) {
  return readLabelsJson(row?.labels_json).map((label) => ({
    id: String(label.id),
    name: String(label.name || ""),
  })).filter((label) => label.id && label.name);
}

export async function getTicketLabels(env, organizationId, ticketId) {
  await assertTicketSelectiveAccessReady(env);
  await requireTicketExistsForAdmin(env, organizationId, ticketId);
  const [assigned, available] = await Promise.all([
    getDb(env).prepare(`SELECT l.id, l.name FROM ticket_label_links ll
      INNER JOIN ticket_labels l ON l.id = ll.label_id AND l.organization_id = ll.organization_id
      WHERE ll.organization_id = ? AND ll.ticket_id = ? AND l.active = 1 ORDER BY LOWER(l.name), l.id`).bind(organizationId, ticketId).all(),
    getDb(env).prepare(`SELECT id, name FROM ticket_labels WHERE organization_id = ? AND active = 1 ORDER BY LOWER(name), id`).bind(organizationId).all(),
  ]);
  return {
    labels: (assigned?.results || []).map((row) => ({ id: row.id, name: row.name })),
    available: (available?.results || []).map((row) => ({ id: row.id, name: row.name })),
  };
}

function normalizeLabelInputs(payload) {
  const raw = payload?.labels;
  if (!Array.isArray(raw)) throw accessError("A lista de etiquetas deve ser um array.");
  const names = [];
  for (const item of raw) {
    const name = cleanText(typeof item === "string" ? item : item?.name, "Nome da etiqueta", { required: true, max: 80 });
    if (!names.some((existing) => existing.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) names.push(name);
  }
  if (names.length > 30) throw accessError("Um chamado pode ter no máximo 30 etiquetas.", 400, "TICKET_LABEL_LIMIT");
  return names;
}

export async function replaceTicketLabels(env, organizationId, ticketId, payload, actorId) {
  await assertTicketSelectiveAccessReady(env);
  await requireTicketExistsForAdmin(env, organizationId, ticketId);
  const names = normalizeLabelInputs(payload);
  const db = getDb(env);
  const now = nowIso();
  const statements = [db.prepare(`DELETE FROM ticket_label_links WHERE organization_id = ? AND ticket_id = ?`).bind(organizationId, ticketId)];
  for (const name of names) {
    const candidateId = randomId("talbl");
    statements.push(db.prepare(`INSERT OR IGNORE INTO ticket_labels
      (id, organization_id, name, active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)`).bind(candidateId, organizationId, name, actorId, now, now));
    statements.push(db.prepare(`INSERT INTO ticket_label_links
      (organization_id, ticket_id, label_id, created_by, created_at)
      SELECT ?, ?, id, ?, ? FROM ticket_labels
      WHERE organization_id = ? AND active = 1 AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`)
      .bind(organizationId, ticketId, actorId, now, organizationId, name));
  }
  statements.push(db.prepare(`INSERT INTO ticket_events
    (organization_id, ticket_id, event_type, actor_user_id, metadata, created_at, entity_version)
    SELECT organization_id, id, 'ticket.labels.changed', ?, ?, ?, version
    FROM organization_tickets WHERE organization_id = ? AND id = ? AND active = 1`)
    .bind(actorId, JSON.stringify({ labels: names }), now, organizationId, ticketId));
  await db.batch(statements);
  return getTicketLabels(env, organizationId, ticketId);
}
