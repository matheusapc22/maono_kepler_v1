export type RoadmapStatus = "draft" | "active" | "archived";
export type RoadmapTaskStatus = "planned" | "in_progress" | "review" | "completed" | "blocked" | "cancelled";
export type RoadmapPriority = "low" | "normal" | "high" | "critical";
export type RoadmapScale = "day" | "week" | "month";
export type RoadmapView = "gantt" | "list";

export type RoadmapSummary = {
  id: number; organizationId: number; name: string; description?: string | null;
  startDate: string; endDate: string; calendarPolicy: "calendar_days" | "business_days";
  timezone: string; status: RoadmapStatus; version: number; createdAt: string; updatedAt: string;
};
export type RoadmapPhase = { id: number; name: string; color: string; sortOrder: number };
export type RoadmapPerson = { id: number; name?: string | null; email?: string | null };
export type RoadmapTask = {
  id: number; roadmapId: number; phaseId: number; phaseName: string; phaseColor: string;
  title: string; description?: string | null; startDate: string; endDate: string; durationDays: number;
  status: RoadmapTaskStatus; progress: number; priority: RoadmapPriority;
  assigneeId?: number | null; assigneeName?: string | null; isMilestone: boolean;
  sortOrder: number; version: number; createdAt: string; updatedAt: string;
};
export type RoadmapMetrics = { progress: number; inProgress: number; overdue: number; blocked: number; nextMilestone?: RoadmapTask | null };
export type RoadmapBundle = { roadmap: RoadmapSummary; phases: RoadmapPhase[]; tasks: RoadmapTask[]; assignees: RoadmapPerson[]; metrics: RoadmapMetrics };
export type RoadmapComment = { id: number; content: string; authorId: number; authorName?: string; authorRole?: string; editedAt?: string | null; createdAt: string };
export type RoadmapFilters = { search: string; status: "" | RoadmapTaskStatus; priority: "" | RoadmapPriority; assigneeId: string; phaseId: string; periodStart: string; periodEnd: string };
export const DEFAULT_ROADMAP_FILTERS: RoadmapFilters = { search: "", status: "", priority: "", assigneeId: "", phaseId: "", periodStart: "", periodEnd: "" };

export const ROADMAP_STATUS_LABELS: Record<RoadmapTaskStatus, string> = {
  planned: "Planejado", in_progress: "Em andamento", review: "Em revisão",
  completed: "Concluído", blocked: "Bloqueado", cancelled: "Cancelado",
};
export const ROADMAP_PRIORITY_LABELS: Record<RoadmapPriority, string> = { low: "Baixa", normal: "Normal", high: "Alta", critical: "Crítica" };
