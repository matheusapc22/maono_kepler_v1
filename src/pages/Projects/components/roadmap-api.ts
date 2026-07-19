import type { RoadmapBundle, RoadmapComment, RoadmapFilters, RoadmapSummary, RoadmapTask } from "./roadmap-types";

export class RoadmapApiError extends Error {
  status?: number; code?: string; requestId?: string;
  constructor(message: string, details: { status?: number; code?: string; requestId?: string } = {}) { super(message); this.name = "RoadmapApiError"; Object.assign(this, details); }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { credentials: "include", ...init, headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } }); }
  catch { throw new RoadmapApiError("Falha de rede ao acessar o Roadmap.", { code: "NETWORK_ERROR" }); }
  const data = await response.json().catch(() => ({})) as { error?: string; code?: string; requestId?: string } & T;
  if (!response.ok) throw new RoadmapApiError(data.error || "Não foi possível concluir a operação.", { status: response.status, code: data.code, requestId: data.requestId || response.headers.get("X-Request-Id") || undefined });
  return data;
}
const base = (organizationId: number | string) => `/api/organizations/${encodeURIComponent(organizationId)}/roadmaps`;
export async function listRoadmaps(organizationId: number | string, signal?: AbortSignal) { return (await request<{ roadmaps: RoadmapSummary[] }>(base(organizationId), { signal })).roadmaps || []; }
export async function createRoadmap(organizationId: number | string, payload: { name: string; description?: string; startDate: string; endDate: string }) { return (await request<{ roadmap: RoadmapSummary }>(base(organizationId), { method: "POST", body: JSON.stringify(payload) })).roadmap; }
export async function getRoadmap(organizationId: number | string, roadmapId: number, filters: RoadmapFilters, signal?: AbortSignal) {
  const query = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
  return request<RoadmapBundle>(`${base(organizationId)}/${roadmapId}?${query}`, { signal });
}
export async function createRoadmapTask(organizationId: number | string, roadmapId: number, payload: Record<string, unknown>) { return (await request<{ task: RoadmapTask }>(`${base(organizationId)}/${roadmapId}/tasks`, { method: "POST", body: JSON.stringify(payload) })).task; }
export async function updateRoadmapTask(organizationId: number | string, roadmapId: number, taskId: number, payload: Record<string, unknown>) { return (await request<{ task: RoadmapTask }>(`${base(organizationId)}/${roadmapId}/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(payload) })).task; }
export async function deleteRoadmapTask(organizationId: number | string, roadmapId: number, taskId: number) { await request(`${base(organizationId)}/${roadmapId}/tasks/${taskId}`, { method: "DELETE" }); }
export async function listTaskComments(organizationId: number | string, roadmapId: number, taskId: number) { return (await request<{ comments: RoadmapComment[] }>(`${base(organizationId)}/${roadmapId}/tasks/${taskId}/comments`)).comments || []; }
export async function createTaskComment(organizationId: number | string, roadmapId: number, taskId: number, content: string) { return (await request<{ comments: RoadmapComment[] }>(`${base(organizationId)}/${roadmapId}/tasks/${taskId}/comments`, { method: "POST", body: JSON.stringify({ content }) })).comments || []; }
