import { jsonResponse } from "./organizations.js";

const ROADMAP_STATUSES = new Set(["draft", "active", "archived"]);
const TASK_STATUSES = new Set(["planned", "in_progress", "review", "completed", "blocked", "cancelled"]);
const PRIORITIES = new Set(["low", "normal", "high", "critical"]);

function db(env) {
  const value = env.DB || env.D1 || env.MAONO_DB;
  if (!value?.prepare) throw apiError("Banco D1 não configurado.", 500, "DATABASE_NOT_CONFIGURED");
  return value;
}

function apiError(message, status = 400, code = "BAD_REQUEST", extra = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function text(value, name, max, required = false) {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) throw apiError(`${name} é obrigatório.`, 400, "VALIDATION_ERROR");
  if (normalized.length > max) throw apiError(`${name} excede ${max} caracteres.`, 400, "VALIDATION_ERROR");
  return normalized || null;
}

function positiveId(value, name) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw apiError(`${name} inválido.`, 400, "VALIDATION_ERROR");
  return id;
}

function dateOnly(value, name) {
  const normalized = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw apiError(`${name} inválida.`, 400, "INVALID_DATE");
  }
  return normalized;
}

function now() { return new Date().toISOString(); }

async function event(env, organizationId, roadmapId, taskId, actorId, eventType, metadata = {}) {
  await db(env).prepare(
    `INSERT INTO roadmap_events (organization_id, roadmap_id, task_id, actor_user_id, event_type, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(organizationId, roadmapId, taskId || null, actorId || null, eventType, JSON.stringify(metadata)).run();
}

export function roadmapErrorResponse(error, request) {
  const status = Number(error?.status || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const requestId = request?.headers?.get("X-Request-Id") || crypto.randomUUID();
  if (safeStatus >= 500) console.error(`[Maono roadmap][${requestId}]`, error);
  return jsonResponse({
    ok: false,
    error: safeStatus >= 500 ? "Erro interno ao processar o roadmap." : error?.message,
    code: error?.code || "ROADMAP_INTERNAL_ERROR",
    requestId,
  }, { status: safeStatus, headers: { "X-Request-Id": requestId } });
}

export async function assertRoadmapSchema(env) {
  try {
    await db(env).prepare("SELECT id FROM organization_roadmaps LIMIT 1").first();
  } catch {
    throw apiError("A migration 0011_roadmap_gantt.sql ainda não foi aplicada.", 503, "ROADMAP_SCHEMA_OUTDATED");
  }
}

function roadmapRow(row) {
  return {
    id: row.id, organizationId: row.organization_id, name: row.name,
    description: row.description, startDate: row.start_date, endDate: row.end_date,
    calendarPolicy: row.calendar_policy, timezone: row.timezone, status: row.status,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function taskRow(row) {
  return {
    id: row.id, roadmapId: row.roadmap_id, phaseId: row.phase_id, phaseName: row.phase_name,
    phaseColor: row.phase_color, title: row.title, description: row.description,
    startDate: row.start_date, endDate: row.end_date, durationDays: row.duration_days,
    status: row.status, progress: row.progress, priority: row.priority,
    assigneeId: row.assignee_id, assigneeName: row.assignee_name,
    isMilestone: Boolean(row.is_milestone), sortOrder: row.sort_order, version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function getRoadmap(env, organizationId, roadmapId) {
  const row = await db(env).prepare(
    `SELECT * FROM organization_roadmaps WHERE id = ? AND organization_id = ? AND status <> 'archived'`,
  ).bind(roadmapId, organizationId).first();
  if (!row) throw apiError("Roadmap não encontrado.", 404, "ROADMAP_NOT_FOUND");
  return row;
}

export async function listRoadmaps(env, organizationId) {
  const result = await db(env).prepare(
    `SELECT * FROM organization_roadmaps WHERE organization_id = ? AND status <> 'archived' ORDER BY updated_at DESC`,
  ).bind(organizationId).all();
  return (result.results || []).map(roadmapRow);
}

export async function createRoadmap(env, organizationId, user, payload) {
  const name = text(payload.name, "Nome", 160, true);
  const description = text(payload.description, "Descrição", 2000);
  const startDate = dateOnly(payload.startDate, "Data inicial");
  const endDate = dateOnly(payload.endDate, "Data final");
  if (endDate < startDate) throw apiError("A data final não pode ser anterior à inicial.", 400, "INVALID_DATE_RANGE");
  const result = await db(env).prepare(
    `INSERT INTO organization_roadmaps (organization_id, name, description, start_date, end_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(organizationId, name, description, startDate, endDate, user.id).run();
  const roadmapId = result.meta?.last_row_id;
  await db(env).prepare(
    `INSERT INTO roadmap_phases (organization_id, roadmap_id, name, color, sort_order) VALUES (?, ?, 'Planejamento', '#D6A84F', 0)`,
  ).bind(organizationId, roadmapId).run();
  await event(env, organizationId, roadmapId, null, user.id, "roadmap.created", { name });
  return roadmapRow(await getRoadmap(env, organizationId, roadmapId));
}

export async function updateRoadmap(env, organizationId, roadmapId, user, payload, archive = false) {
  const current = await getRoadmap(env, organizationId, roadmapId);
  if (payload.version !== undefined && Number(payload.version) !== Number(current.version)) throw apiError("O roadmap foi alterado por outra pessoa.", 409, "VERSION_CONFLICT");
  const name = payload.name !== undefined ? text(payload.name, "Nome", 160, true) : current.name;
  const description = payload.description !== undefined ? text(payload.description, "Descrição", 2000) : current.description;
  const startDate = payload.startDate !== undefined ? dateOnly(payload.startDate, "Data inicial") : current.start_date;
  const endDate = payload.endDate !== undefined ? dateOnly(payload.endDate, "Data final") : current.end_date;
  if (endDate < startDate) throw apiError("A data final não pode ser anterior à inicial.", 400, "INVALID_DATE_RANGE");
  const status = archive ? "archived" : ROADMAP_STATUSES.has(payload.status) ? payload.status : current.status;
  await db(env).prepare(`UPDATE organization_roadmaps SET name=?, description=?, start_date=?, end_date=?, status=?, archived_at=?, version=version+1, updated_at=? WHERE id=? AND organization_id=? AND version=?`).bind(name, description, startDate, endDate, status, archive ? now() : current.archived_at, now(), roadmapId, organizationId, current.version).run();
  await event(env, organizationId, roadmapId, null, user.id, archive ? "roadmap.archived" : "roadmap.updated", { beforeVersion: current.version });
  return archive ? null : roadmapRow(await getRoadmap(env, organizationId, roadmapId));
}

export async function createPhase(env, organizationId, roadmapId, user, payload) {
  await getRoadmap(env, organizationId, roadmapId);
  const name = text(payload.name, "Nome da fase", 120, true);
  const color = /^#[0-9a-f]{6}$/i.test(String(payload.color || "")) ? payload.color : "#D6A84F";
  const result = await db(env).prepare(`INSERT INTO roadmap_phases (organization_id, roadmap_id, name, color, sort_order) VALUES (?, ?, ?, ?, COALESCE((SELECT MAX(sort_order)+1 FROM roadmap_phases WHERE roadmap_id=?),0))`).bind(organizationId, roadmapId, name, color, roadmapId).run();
  await event(env, organizationId, roadmapId, null, user.id, "roadmap.updated", { phaseCreated: result.meta?.last_row_id });
  return { id: result.meta?.last_row_id, name, color };
}

export async function createDependency(env, organizationId, roadmapId, taskId, user, payload) {
  const predecessorId = positiveId(payload.predecessorTaskId, "Predecessora");
  const successorId = positiveId(taskId, "Sucessora");
  if (predecessorId === successorId) throw apiError("Uma tarefa não pode depender dela mesma.", 400, "DEPENDENCY_CYCLE");
  const rows = await db(env).prepare(`SELECT id FROM roadmap_tasks WHERE organization_id=? AND roadmap_id=? AND id IN (?,?) AND archived_at IS NULL`).bind(organizationId, roadmapId, predecessorId, successorId).all();
  if ((rows.results || []).length !== 2) throw apiError("Tarefa da dependência não encontrada.", 404, "TASK_NOT_FOUND");
  const cycle = await db(env).prepare(`WITH RECURSIVE chain(id) AS (
    SELECT successor_task_id FROM roadmap_dependencies WHERE organization_id=? AND roadmap_id=? AND predecessor_task_id=?
    UNION SELECT d.successor_task_id FROM roadmap_dependencies d JOIN chain c ON d.predecessor_task_id=c.id WHERE d.organization_id=? AND d.roadmap_id=?
  ) SELECT 1 AS found FROM chain WHERE id=? LIMIT 1`).bind(organizationId, roadmapId, successorId, organizationId, roadmapId, predecessorId).first();
  if (cycle) throw apiError("A dependência criaria um ciclo.", 400, "DEPENDENCY_CYCLE");
  const result = await db(env).prepare(`INSERT INTO roadmap_dependencies (organization_id, roadmap_id, predecessor_task_id, successor_task_id, created_by) VALUES (?, ?, ?, ?, ?)`).bind(organizationId, roadmapId, predecessorId, successorId, user.id).run();
  await event(env, organizationId, roadmapId, successorId, user.id, "roadmap.dependency.changed", { action: "created", predecessorId });
  return { id: result.meta?.last_row_id, predecessorTaskId: predecessorId, successorTaskId: successorId, type: "finish_to_start" };
}

export async function deleteDependency(env, organizationId, roadmapId, taskId, dependencyId, user) {
  const result = await db(env).prepare(`DELETE FROM roadmap_dependencies WHERE id=? AND organization_id=? AND roadmap_id=? AND successor_task_id=?`).bind(dependencyId, organizationId, roadmapId, taskId).run();
  if (!result.meta?.changes) throw apiError("Dependência não encontrada.", 404, "DEPENDENCY_NOT_FOUND");
  await event(env, organizationId, roadmapId, taskId, user.id, "roadmap.dependency.changed", { action: "deleted", dependencyId });
}

export async function getRoadmapBundle(env, organizationId, roadmapId, query = {}) {
  const roadmap = roadmapRow(await getRoadmap(env, organizationId, roadmapId));
  const clauses = ["t.organization_id = ?", "t.roadmap_id = ?", "t.archived_at IS NULL"];
  const values = [organizationId, roadmapId];
  if (query.status) { clauses.push("t.status = ?"); values.push(query.status); }
  if (query.priority) { clauses.push("t.priority = ?"); values.push(query.priority); }
  if (query.assigneeId) { clauses.push("t.assignee_id = ?"); values.push(Number(query.assigneeId)); }
  if (query.phaseId) { clauses.push("t.phase_id = ?"); values.push(Number(query.phaseId)); }
  if (query.search) { clauses.push("(LOWER(t.title) LIKE ? OR LOWER(t.description) LIKE ?)"); const q = `%${String(query.search).toLowerCase()}%`; values.push(q, q); }
  if (query.periodStart) { clauses.push("t.end_date >= ?"); values.push(query.periodStart); }
  if (query.periodEnd) { clauses.push("t.start_date <= ?"); values.push(query.periodEnd); }
  const [phasesResult, tasksResult, assigneesResult] = await Promise.all([
    db(env).prepare(`SELECT id, name, color, sort_order AS sortOrder FROM roadmap_phases WHERE organization_id = ? AND roadmap_id = ? AND active = 1 ORDER BY sort_order, id`).bind(organizationId, roadmapId).all(),
    db(env).prepare(`SELECT t.*, p.name AS phase_name, p.color AS phase_color, u.name AS assignee_name
      FROM roadmap_tasks t JOIN roadmap_phases p ON p.id = t.phase_id LEFT JOIN users u ON u.id = t.assignee_id
      WHERE ${clauses.join(" AND ")} ORDER BY p.sort_order, t.sort_order, t.start_date, t.id`).bind(...values).all(),
    db(env).prepare(`SELECT u.id, u.name, u.email FROM organization_users ou JOIN users u ON u.id = ou.user_id WHERE ou.organization_id = ? AND u.active = 1 ORDER BY u.name, u.email`).bind(organizationId).all(),
  ]);
  const tasks = (tasksResult.results || []).map(taskRow);
  const active = tasks.filter((task) => task.status !== "cancelled");
  const completedWeight = active.reduce((sum, task) => sum + task.progress, 0);
  const today = new Date().toISOString().slice(0, 10);
  return {
    roadmap,
    phases: phasesResult.results || [], tasks, assignees: assigneesResult.results || [],
    metrics: {
      progress: active.length ? Math.round(completedWeight / active.length) : 0,
      inProgress: tasks.filter((task) => task.status === "in_progress").length,
      overdue: tasks.filter((task) => !["completed", "cancelled"].includes(task.status) && task.endDate < today).length,
      blocked: tasks.filter((task) => task.status === "blocked").length,
      nextMilestone: tasks.filter((task) => task.isMilestone && task.startDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0] || null,
    },
  };
}

async function assertPhase(env, organizationId, roadmapId, phaseId) {
  const row = await db(env).prepare(`SELECT id FROM roadmap_phases WHERE id = ? AND organization_id = ? AND roadmap_id = ? AND active = 1`).bind(phaseId, organizationId, roadmapId).first();
  if (!row) throw apiError("Fase inválida.", 400, "INVALID_PHASE");
}

async function assertAssignee(env, organizationId, assigneeId) {
  if (!assigneeId) return;
  const row = await db(env).prepare(`SELECT 1 FROM organization_users WHERE organization_id = ? AND user_id = ?`).bind(organizationId, assigneeId).first();
  if (!row) throw apiError("Responsável não pertence à organização.", 400, "INVALID_ASSIGNEE");
}

export async function createTask(env, organizationId, roadmapId, user, payload) {
  await getRoadmap(env, organizationId, roadmapId);
  const phaseId = positiveId(payload.phaseId, "Fase");
  await assertPhase(env, organizationId, roadmapId, phaseId);
  const assigneeId = payload.assigneeId ? positiveId(payload.assigneeId, "Responsável") : null;
  await assertAssignee(env, organizationId, assigneeId);
  const title = text(payload.title, "Título", 180, true);
  const description = text(payload.description, "Descrição", 5000);
  const startDate = dateOnly(payload.startDate, "Data inicial");
  const endDate = dateOnly(payload.endDate, "Data final");
  if (endDate < startDate) throw apiError("A data final não pode ser anterior à inicial.", 400, "INVALID_DATE_RANGE");
  const isMilestone = Boolean(payload.isMilestone);
  const durationDays = isMilestone ? 0 : Math.max(1, Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1);
  const status = TASK_STATUSES.has(payload.status) ? payload.status : "planned";
  const priority = PRIORITIES.has(payload.priority) ? payload.priority : "normal";
  const progress = isMilestone ? (Number(payload.progress) === 100 ? 100 : 0) : Math.max(0, Math.min(100, Number(payload.progress) || 0));
  const result = await db(env).prepare(
    `INSERT INTO roadmap_tasks (organization_id, roadmap_id, phase_id, title, description, start_date, end_date, duration_days, status, progress, priority, assignee_id, is_milestone, sort_order, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM roadmap_tasks WHERE roadmap_id = ? AND phase_id = ?), 0), ?)`,
  ).bind(organizationId, roadmapId, phaseId, title, description, startDate, endDate, durationDays, status, progress, priority, assigneeId, isMilestone ? 1 : 0, roadmapId, phaseId, user.id).run();
  await event(env, organizationId, roadmapId, result.meta?.last_row_id, user.id, "roadmap.task.created", { title });
  return (await getRoadmapBundle(env, organizationId, roadmapId)).tasks.find((task) => Number(task.id) === Number(result.meta?.last_row_id));
}

export async function updateTask(env, organizationId, roadmapId, taskId, user, payload) {
  const current = await db(env).prepare(`SELECT * FROM roadmap_tasks WHERE id = ? AND organization_id = ? AND roadmap_id = ? AND archived_at IS NULL`).bind(taskId, organizationId, roadmapId).first();
  if (!current) throw apiError("Tarefa não encontrada.", 404, "TASK_NOT_FOUND");
  if (Number(payload.version) !== Number(current.version)) throw apiError("A tarefa foi alterada por outra pessoa. Recarregue antes de salvar.", 409, "VERSION_CONFLICT", { currentVersion: current.version });
  const next = { ...current };
  if (payload.title !== undefined) next.title = text(payload.title, "Título", 180, true);
  if (payload.description !== undefined) next.description = text(payload.description, "Descrição", 5000);
  if (payload.startDate !== undefined) next.start_date = dateOnly(payload.startDate, "Data inicial");
  if (payload.endDate !== undefined) next.end_date = dateOnly(payload.endDate, "Data final");
  if (next.end_date < next.start_date) throw apiError("A data final não pode ser anterior à inicial.", 400, "INVALID_DATE_RANGE");
  if (payload.status !== undefined) { if (!TASK_STATUSES.has(payload.status)) throw apiError("Status inválido."); next.status = payload.status; }
  if (payload.priority !== undefined) { if (!PRIORITIES.has(payload.priority)) throw apiError("Prioridade inválida."); next.priority = payload.priority; }
  if (payload.progress !== undefined) next.progress = Math.max(0, Math.min(100, Number(payload.progress) || 0));
  if (payload.assigneeId !== undefined) { next.assignee_id = payload.assigneeId ? positiveId(payload.assigneeId, "Responsável") : null; await assertAssignee(env, organizationId, next.assignee_id); }
  next.duration_days = next.is_milestone ? 0 : Math.max(1, Math.round((Date.parse(`${next.end_date}T00:00:00Z`) - Date.parse(`${next.start_date}T00:00:00Z`)) / 86400000) + 1);
  await db(env).prepare(`UPDATE roadmap_tasks SET title=?, description=?, start_date=?, end_date=?, duration_days=?, status=?, progress=?, priority=?, assignee_id=?, version=version+1, updated_at=? WHERE id=? AND version=?`).bind(next.title, next.description, next.start_date, next.end_date, next.duration_days, next.status, next.progress, next.priority, next.assignee_id, now(), taskId, current.version).run();
  await event(env, organizationId, roadmapId, taskId, user.id, "roadmap.task.updated", { beforeVersion: current.version });
  return (await getRoadmapBundle(env, organizationId, roadmapId)).tasks.find((task) => Number(task.id) === Number(taskId));
}

export async function archiveTask(env, organizationId, roadmapId, taskId, user) {
  const result = await db(env).prepare(`UPDATE roadmap_tasks SET archived_at=?, updated_at=?, version=version+1 WHERE id=? AND organization_id=? AND roadmap_id=? AND archived_at IS NULL`).bind(now(), now(), taskId, organizationId, roadmapId).run();
  if (!result.meta?.changes) throw apiError("Tarefa não encontrada.", 404, "TASK_NOT_FOUND");
  await event(env, organizationId, roadmapId, taskId, user.id, "roadmap.task.deleted");
}

export async function listComments(env, organizationId, roadmapId, taskId) {
  const result = await db(env).prepare(`SELECT c.id, c.content, c.author_user_id AS authorId, u.name AS authorName, u.role AS authorRole, c.edited_at AS editedAt, c.created_at AS createdAt FROM roadmap_comments c JOIN users u ON u.id=c.author_user_id WHERE c.organization_id=? AND c.roadmap_id=? AND c.task_id=? AND c.active=1 ORDER BY c.created_at`).bind(organizationId, roadmapId, taskId).all();
  return result.results || [];
}

export async function createComment(env, organizationId, roadmapId, taskId, user, payload) {
  const content = text(payload.content, "Comentário", 2000, true);
  const task = await db(env).prepare(`SELECT id FROM roadmap_tasks WHERE id=? AND organization_id=? AND roadmap_id=? AND archived_at IS NULL`).bind(taskId, organizationId, roadmapId).first();
  if (!task) throw apiError("Tarefa não encontrada.", 404, "TASK_NOT_FOUND");
  await db(env).prepare(`INSERT INTO roadmap_comments (organization_id, roadmap_id, task_id, author_user_id, content) VALUES (?, ?, ?, ?, ?)`).bind(organizationId, roadmapId, taskId, user.id, content).run();
  await event(env, organizationId, roadmapId, taskId, user.id, "roadmap.comment.created");
  return listComments(env, organizationId, roadmapId, taskId);
}

export { ROADMAP_STATUSES, TASK_STATUSES, PRIORITIES };
