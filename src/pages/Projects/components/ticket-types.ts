export type TicketViewMode = "list" | "kanban" | "calendar";

export type TicketStatus =
  | "new"
  | "open"
  | "in_progress"
  | "in_review"
  | "closed";

export type TicketPriority = "low" | "normal" | "high";

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

export type TicketEvent = {
  id: number | string;
  type: string;
  metadata?: Record<string, unknown>;
  createdAt?: string | null;
  actor?: TicketPerson | null;
};

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
};

export type TicketFilters = {
  q: string;
  status: "" | TicketStatus;
  priority: "" | TicketPriority;
  assigneeId: string;
  from: string;
  to: string;
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
  tickets: Ticket[];
  pagination: TicketPagination;
  facets: TicketFacets;
  range: {
    from?: string | null;
    to?: string | null;
  };
  assignees: TicketPerson[];
};

export type TicketDetailResponse = {
  ok: boolean;
  ticket: Ticket;
  attachments: TicketAttachment[];
  events: TicketEvent[];
  assignees: TicketPerson[];
};

export type CreateTicketPayload = {
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

