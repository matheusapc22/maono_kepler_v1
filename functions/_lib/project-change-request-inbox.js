import { publicRequestLifecycle } from "./project-change-request-lifecycle.js";
import { getDb, tableExists } from "./organizations.js";
import { CHANGE_REQUEST_STATUSES } from "./project-change-requests.js";
import { requireReviewerProject } from "./project-change-request-review.js";

function badOptions() {
  return Object.assign(new Error("Filtro ou paginação de solicitações inválido."), {
    status: 400, code: "CHANGE_REQUEST_INBOX_INVALID_OPTIONS",
  });
}

export function parseInboxOptions(url) {
  const status = url.searchParams.get("status") || "pending";
  if (!["pending", "all", ...CHANGE_REQUEST_STATUSES].includes(status)) throw badOptions();
  const page = Number(url.searchParams.get("page") || 1);
  const limit = Number(url.searchParams.get("limit") || 25);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw badOptions();
  return { status, page, limit };
}

export function reviewPath(slug, id) {
  return `/projects/${encodeURIComponent(slug)}/review/${encodeURIComponent(id)}`;
}

export async function listEditorProjectChangeRequests(env, request, slug, options) {
  const { project } = await requireReviewerProject(env, request, slug);
  const { status, page, limit } = options;
  const statusSql = status === "pending"
    ? "AND r.status IN ('submitted', 'under_review', 'approved', 'applying')"
    : status === "all" ? "" : "AND r.status = ?";
  const parameters = [project.id, project.organization_id];
  if (status !== "pending" && status !== "all") parameters.push(status);
  // limit + 1 avoids an unbounded COUNT and does not fetch operation payloads.
  const result = await getDb(env).prepare(`
    SELECT r.id, r.status, r.reason, r.base_revision, r.submitted_at,
           r.ticket_id, t.code AS ticket_code, t.subject AS ticket_subject,
           u.name AS requester_name,
           (SELECT COUNT(*) FROM project_change_operations o
             WHERE o.change_request_id = r.id) AS operation_count
      FROM project_change_requests r
      LEFT JOIN organization_tickets t ON t.id = r.ticket_id
        AND t.organization_id = r.organization_id
      LEFT JOIN users u ON u.id = r.requested_by_user_id
     WHERE r.project_id = ? AND r.organization_id = ? ${statusSql}
     ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?
  `).bind(...parameters, limit + 1, (page - 1) * limit).all();
  const rows = result?.results || [];
  return {
    project: { id: project.id, slug: project.slug, name: project.name },
    items: rows.slice(0, limit).map(row => ({
      id: row.id, status: row.status, reason: row.reason,
      baseRevision: Number(row.base_revision), submittedAt: row.submitted_at,
      operationCount: Number(row.operation_count), requesterName: row.requester_name,
      ticket: row.ticket_code ? { id: row.ticket_id, code: row.ticket_code, subject: row.ticket_subject } : null,
      reviewUrl: reviewPath(project.slug, row.id),
    })),
    pagination: { page, limit, hasMore: rows.length > limit },
  };
}

// Called only after ticket.view and ticket existence have been checked.
export async function getTicketReviewLink(env, request, organizationId, ticketId) {
  if (!(await tableExists(env, "project_change_requests"))) return null;
  const row = await getDb(env).prepare(`
    SELECT r.*, p.slug
      FROM project_change_requests r
      INNER JOIN projects p ON p.id = r.project_id
        AND p.organization_id = r.organization_id
     WHERE r.organization_id = ? AND r.ticket_id = ? LIMIT 1
  `).bind(organizationId, ticketId).first();
  if (!row) return null;
  try {
    await requireReviewerProject(env, request, row.slug);
  } catch (error) {
    if ([403, 404].includes(Number(error.status || error.statusCode))) return null;
    throw error;
  }
  return { ...publicRequestLifecycle(row), id: row.id, status: row.status, reviewUrl: reviewPath(row.slug, row.id) };
}
