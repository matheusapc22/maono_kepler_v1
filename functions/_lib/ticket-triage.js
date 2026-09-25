import { getDb, getTableColumns } from "./organizations.js";

export const TICKET_DEMAND_NATURES = Object.freeze([
  "question_request", "incident", "defect", "improvement_change", "recurring_problem",
]);
export const TICKET_TRIAGE_IMPACTS = Object.freeze(["individual", "team", "organization"]);
export const TICKET_TRIAGE_URGENCIES = Object.freeze(["flexible", "soon", "blocked"]);
export const TICKET_TRIAGE_FORM_VERSION = 1;
export const TICKET_TRIAGE_FIELDS = Object.freeze({
  demandNature: "demand_nature",
  expectedResult: "expected_result",
  context: "context",
  impact: "impact",
  urgency: "urgency",
  priorityReason: "priority_reason",
  triageAnswers: "triage_answers",
  triageFormVersion: "triage_form_version",
});
export const TICKET_TRIAGE_COLUMNS = Object.freeze([
  ...Object.values(TICKET_TRIAGE_FIELDS), "triage_source", "triaged_at", "triaged_by",
]);
export const TICKET_TRIAGE_QUESTIONS = Object.freeze({
  question_request: { required: [], optional: [] },
  incident: { required: ["startedAt", "impactDescription"], optional: ["workaround"] },
  defect: { required: ["stepsToReproduce", "actualResult", "affectedVersion"], optional: [] },
  improvement_change: { required: ["problemToSolve", "expectedBenefit"], optional: [] },
  recurring_problem: { required: ["recurrenceFrequency", "relatedContext"], optional: [] },
});

const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function triageError(message, status = 400, code = "TICKET_TRIAGE_INVALID") {
  return Object.assign(new Error(message), { status, code, publicMessage: message });
}
function text(value, name, { required = false, max = 2000 } = {}) {
  if (value === undefined) value = "";
  if (typeof value !== "string") throw triageError(`O campo ${name} deve ser texto.`);
  const result = value.trim();
  if ((required && !result) || result.length > max) {
    throw triageError(`Preencha ${name}${required ? " (obrigatório)" : ""} com até ${max} caracteres.`);
  }
  return result;
}
function choice(value, choices, name) {
  if (!choices.includes(value)) throw triageError(`Valor inválido para ${name}.`);
  return value;
}

export function isTicketTriageEnabled(env) {
  return String(env?.MAONO_TICKET_TRIAGE_ENABLED || "").trim().toLowerCase() === "true";
}
export function hasTicketTriagePayload(payload) {
  return Object.keys(TICKET_TRIAGE_FIELDS).some((key) => own(payload, key));
}

// Do not probe or consume new columns while the flag is off. Missing columns are
// an unsupported read capability, not implicit permission to run a migration.
export async function getTicketTriageCapability(env) {
  if (!isTicketTriageEnabled(env)) return false;
  try {
    const columns = await getTableColumns(env, "organization_tickets");
    return TICKET_TRIAGE_COLUMNS.every((column) => columns.has(column));
  } catch (error) {
    if (error?.code === "TABLE_NOT_FOUND") return false;
    throw error;
  }
}

export async function assertTicketTriageWriteReady(env, payload) {
  if (!isTicketTriageEnabled(env)) {
    if (hasTicketTriagePayload(payload)) {
      throw triageError("A triagem ainda não está habilitada neste ambiente. Recarregue o chamado antes de tentar novamente.", 503, "TICKET_TRIAGE_DISABLED");
    }
    return false;
  }
  if (!(await getTicketTriageCapability(env))) {
    throw triageError("A triagem está temporariamente indisponível. Tente novamente mais tarde ou contate a equipe responsável.", 503, "TICKET_TRIAGE_SCHEMA_OUTDATED");
  }
  return true;
}

function readAnswers(value) {
  if (record(value)) return value;
  try {
    const parsed = JSON.parse(value || "{}");
    return record(parsed) ? parsed : {};
  } catch { return {}; }
}
export function publicTicketTriage(row) {
  const nature = TICKET_DEMAND_NATURES.includes(row.demand_nature) ? row.demand_nature : null;
  return {
    demandNature: nature,
    expectedResult: row.expected_result || "",
    context: row.context || "",
    impact: row.impact || null,
    urgency: row.urgency || null,
    priorityReason: row.priority_reason || "",
    triageAnswers: readAnswers(row.triage_answers),
    triageFormVersion: row.triage_form_version == null ? null : Number(row.triage_form_version),
    needsTriage: !nature || row.triage_source !== "human",
    triageSource: row.triage_source === "human" ? "human" : "legacy",
    triagedAt: row.triaged_at || null,
    triagedBy: row.triaged_by == null ? null : Number(row.triaged_by),
  };
}

function normalizeAnswers(nature, answers) {
  if (!record(answers)) throw triageError("As respostas de triagem devem ser um objeto.");
  const questions = TICKET_TRIAGE_QUESTIONS[nature];
  const keys = [...questions.required, ...questions.optional];
  if (Object.keys(answers).some((key) => !keys.includes(key))) {
    throw triageError("As respostas não correspondem à natureza e à versão do formulário.");
  }
  const normalized = {};
  for (const key of keys) {
    if (own(answers, key) || questions.required.includes(key)) {
      normalized[key] = text(answers[key], key, { required: questions.required.includes(key) });
    }
  }
  if (JSON.stringify(normalized).length > 14000) {
    throw triageError("As respostas de triagem excedem o tamanho permitido. Reduza o conteúdo antes de enviar.");
  }
  return normalized;
}

// Produces only explicit updates plus human provenance. It does not implement
// CC-03 version/CAS/idempotency or infer classification from old category/text.
export function normalizeTicketTriage(payload, {
  current = null, priority = "normal", category = current?.category, actorId, now = new Date().toISOString(), creating = false,
} = {}) {
  if (!record(payload)) throw triageError("O conteúdo da triagem deve ser um objeto.");
  const present = Object.keys(TICKET_TRIAGE_FIELDS).filter((key) => own(payload, key));
  const priorityChanged = !creating && own(payload, "priority") && priority !== current?.priority;
  const categoryChanged = !creating && own(payload, "category") && category !== current?.category;
  const natureChanged = Boolean(current?.demand_nature && own(payload, "demandNature") && payload.demandNature !== current.demand_nature);
  const reasonRequired = priorityChanged || categoryChanged || natureChanged || (creating && present.length > 0 && priority !== "normal");
  const reason = own(payload, "priorityReason")
    ? text(payload.priorityReason, "a justificativa", { required: reasonRequired, max: 1000 })
    : "";
  if (reasonRequired && !reason) {
    throw triageError("Registre uma justificativa para alterar a prioridade, o domínio ou a natureza.", 400, "TICKET_TRIAGE_REASON_REQUIRED");
  }
  if (!present.length) return { updates: {}, hasChanges: false };

  const updates = {};
  if (own(payload, "priorityReason")) updates.priority_reason = reason;
  const classifying = present.some((key) => key !== "priorityReason");
  if (!classifying && !creating) return { updates, hasChanges: true };

  const previous = publicTicketTriage(current || {});
  const merged = { ...previous, ...payload };
  const demandNature = choice(merged.demandNature, TICKET_DEMAND_NATURES, "natureza");
  if ((creating || !current?.demand_nature || natureChanged) && !own(payload, "triageAnswers")) {
    throw triageError("Preencha as perguntas da natureza selecionada.");
  }
  if (merged.triageFormVersion !== TICKET_TRIAGE_FORM_VERSION) {
    throw triageError("Versão de formulário de triagem não suportada.", 400, "TICKET_TRIAGE_FORM_VERSION_INVALID");
  }
  const normalized = {
    demandNature,
    expectedResult: text(merged.expectedResult, "o resultado esperado", { required: true }),
    context: text(merged.context, "o contexto"),
    impact: choice(merged.impact, TICKET_TRIAGE_IMPACTS, "impacto"),
    urgency: choice(merged.urgency, TICKET_TRIAGE_URGENCIES, "urgência"),
    priorityReason: own(payload, "priorityReason") ? reason : previous.priorityReason,
    triageAnswers: normalizeAnswers(demandNature, merged.triageAnswers),
    triageFormVersion: TICKET_TRIAGE_FORM_VERSION,
  };
  for (const [key, column] of Object.entries(TICKET_TRIAGE_FIELDS)) {
    if (creating || !current?.demand_nature || own(payload, key)) {
      updates[column] = key === "triageAnswers" ? JSON.stringify(normalized[key]) : normalized[key];
    }
  }
  updates.triage_source = "human";
  updates.triaged_at = now;
  updates.triaged_by = actorId;
  return { updates, hasChanges: true };
}

// Compare only the triage snapshot read by this server request, protecting the
// read/validate -> batch interval. Client version tokens and general optimistic
// concurrency remain the scope of CC-03.
export function ticketTriageSnapshotGuard(current) {
  return {
    sql: TICKET_TRIAGE_COLUMNS.map((column) => ` AND ${column} IS ?`).join(""),
    values: TICKET_TRIAGE_COLUMNS.map((column) => current[column] ?? null),
  };
}

// Read the actual before-values inside the same D1 transaction as the update.
// Explicit columns are fixed in this module, never taken from an SQL identifier
// supplied by a client. A missing/inactive scoped row creates no event.
export function ticketTriageEventStatement(env, { organizationId, ticketId, actorId, updates, now, guard = null }) {
  const pairs = [
    ...Object.entries(TICKET_TRIAGE_FIELDS),
    ["triageSource", "triage_source"], ["triagedAt", "triaged_at"], ["triagedBy", "triaged_by"],
  ];
  const before = pairs.map(([key, col]) => `'${key}', ${col === "triage_answers" ? `json(${col})` : col}`).join(", ");
  const values = [];
  const after = pairs.map(([key, col]) => {
    if (own(updates, col)) {
      values.push(updates[col]);
      return `'${key}', ${col === "triage_answers" ? "json(?)" : "?"}`;
    }
    return `'${key}', ${col === "triage_answers" ? `json(${col})` : col}`;
  }).join(", ");
  return getDb(env).prepare(`INSERT INTO ticket_events
    (organization_id, ticket_id, event_type, actor_user_id, metadata, created_at)
    SELECT organization_id, id, 'ticket.triage.changed', ?,
      json_object('from', json_object(${before}), 'to', json_object(${after})), ?
    FROM organization_tickets WHERE organization_id = ? AND id = ? AND active = 1
      ${guard?.sql || ""}`)
    .bind(actorId, ...values, now, organizationId, ticketId,
      ...(guard?.values || []));
}
