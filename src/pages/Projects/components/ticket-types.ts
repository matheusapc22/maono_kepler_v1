export type TicketViewMode = "list" | "kanban" | "calendar";

export type TicketStatus =
  | "new"
  | "open"
  | "in_progress"
  | "in_review"
  | "closed";

export type TicketPriority = "low" | "normal" | "high";

export type TicketDemandNature =
  | "question_request"
  | "incident"
  | "defect"
  | "improvement_change"
  | "recurring_problem";

export type TicketImpact = "individual" | "team" | "organization";
export type TicketUrgency = "flexible" | "soon" | "blocked";

export type TicketTriagePayload = {
  demandNature: TicketDemandNature;
  expectedResult: string;
  context: string;
  impact: TicketImpact;
  urgency: TicketUrgency;
  priorityReason: string;
  triageAnswers: Record<string, string>;
  triageFormVersion: 1;
};

export type TicketCategory =
  | "map"
  | "database"
  | "permission"
  | "export"
  | "support"
  | "other";

export type TicketPerson = {
  id: number | string;
  name?: string | null;
  email?: string | null;
};

export type TicketAttachment = {
  id: number | string;
  organizationId: number | string;
  ticketId: number | string;
  name: string;
  mimeType: string;
  size: number;
  status: string;
  createdAt?: string | null;
  uploadedBy?: TicketPerson | null;
};

export type TicketAttachmentLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTicketBytes: number;
  chunkBytes: number;
};

export const DEFAULT_TICKET_ATTACHMENT_LIMITS: TicketAttachmentLimits = {
  maxFiles: 5,
  maxFileBytes: 80 * 1024 * 1024,
  maxTicketBytes: 150 * 1024 * 1024,
  chunkBytes: 8 * 1024 * 1024,
};

export type TicketEvent = {
  id: number | string;
  type: string;
  metadata?: Record<string, unknown>;
  createdAt?: string | null;
  actor?: TicketPerson | null;
};

export type TicketClosureOutcome = "resolved" | "answered" | "fulfilled" | "rejected" | "duplicate" | "withdrawn" | "no_action";
export type TicketClosurePayload = {
  outcomeCode: TicketClosureOutcome;
  summary: string;
  evidence: string;
  communication: string;
  pendingChangeAcknowledged?: boolean;
};
export type TicketClosure = TicketClosurePayload & { closedAt: string; closedBy?: number | string | null; cycleNumber?: number };
export type TicketCycle = { number: number; origin: "created" | "observed_baseline" | "reopened"; openedAt: string; openedBy?: number | string | null };
export type TicketWait = { id: number | string; reason: string; responsibleId: number | string; startedAt: string; expectedAt?: string | null; nextAction: string };
export type TicketTransitionPayload = { status: TicketStatus; nextAction?: string; reason?: string; evidence?: string; closure?: TicketClosurePayload };
export type TicketWaitPayload = { action: "start"; reason: string; responsibleId: number | string; nextAction: string; expectedAt?: string | null } | { action: "end"; reason?: string; nextAction: string };
export type TicketReopenPayload = { reason: string; nextAction: string };
export type TicketCommand = { kind: "transition"; payload: TicketTransitionPayload } | { kind: "wait"; payload: TicketWaitPayload } | { kind: "reopen"; payload: TicketReopenPayload };

export type Ticket = {
  id: number | string;
  organizationId: number | string;
  code: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  dueAt?: string | null;
  closedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  createdBy?: TicketPerson | null;
  assignedTo?: TicketPerson | null;
  attachmentsCount: number;
  version?: number;
  /** Opaque write token supplied for the canonical core ticket, never the detail envelope. */
  etag?: string;
  cycle?: TicketCycle | null;
  nextAction?: string;
  wait?: TicketWait | null;
  closure?: TicketClosure | null;
  demandNature?: TicketDemandNature | null;
  expectedResult?: string | null;
  context?: string | null;
  impact?: TicketImpact | null;
  urgency?: TicketUrgency | null;
  priorityReason?: string | null;
  triageAnswers?: Record<string, string> | null;
  triageFormVersion?: number | null;
  needsTriage?: boolean;
  triageSource?: "legacy" | "human" | null;
  triagedAt?: string | null;
  triagedBy?: number | null;
};

export type TicketFilters = {
  q: string;
  status: "" | TicketStatus;
  priority: "" | TicketPriority;
  assigneeId: string;
  from: string;
  to: string;
  overdueOnly: boolean;
  sort: "updated_desc" | "updated_asc" | "due_asc" | "priority_desc";
};

export type TicketFacets = {
  byStatus: Record<TicketStatus, number>;
  overdue: number;
};

export type TicketPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
};

export type TicketListResponse = {
  ok: boolean;
  triageEnabled?: boolean;
  lifecycleEnabled?: boolean;
  tickets: Ticket[];
  pagination: TicketPagination;
  facets: TicketFacets;
  range: {
    from?: string | null;
    to?: string | null;
  };
  assignees: TicketPerson[];
  attachmentLimits: TicketAttachmentLimits;
};

export type TicketDetailResponse = {
  hasPendingChange?: boolean;
  closureHistory?: TicketClosure[];
  triageEnabled?: boolean;
  lifecycleEnabled?: boolean;
  changeRequest?: { id: string; status: string; reviewUrl: string } | null;
  ok: boolean;
  ticket: Ticket;
  attachments: TicketAttachment[];
  events: TicketEvent[];
  assignees: TicketPerson[];
  attachmentLimits: TicketAttachmentLimits;
};

export type CreateTicketPayload = Partial<TicketTriagePayload> & {
  subject: string;
  description: string;
  priority: TicketPriority;
  category: TicketCategory;
  dueAt?: string | null;
  assignedTo?: number | string | null;
};

export type UpdateTicketPayload = Partial<CreateTicketPayload> & {
  status?: TicketStatus;
};

export const DEFAULT_TICKET_FILTERS: TicketFilters = {
  q: "",
  status: "",
  priority: "",
  assigneeId: "",
  from: "",
  to: "",
  overdueOnly: false,
  sort: "updated_desc",
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: "Novo",
  open: "Aberto",
  in_progress: "Em andamento",
  in_review: "Em revisão",
  closed: "Concluído",
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
};

export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  map: "Mapa",
  database: "Base de dados",
  permission: "Permissão",
  export: "Exportação",
  support: "Suporte",
  other: "Outro",
};
