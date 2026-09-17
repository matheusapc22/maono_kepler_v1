import { requestJson } from "../../../lib/api-transport";
import type {
  RoadmapBundle,
  RoadmapComment,
  RoadmapFilters,
  RoadmapSummary,
  RoadmapTask,
} from "./roadmap-types";

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  return requestJson<T>(url, init);
}

const base = (organizationId: number | string) =>
  `/api/organizations/${encodeURIComponent(organizationId)}/roadmaps`;

export async function listRoadmaps(
  organizationId: number | string,
  signal?: AbortSignal,
) {
  return (
    await request<{ roadmaps: RoadmapSummary[] }>(base(organizationId), {
      signal,
    })
  ).roadmaps || [];
}

export async function createRoadmap(
  organizationId: number | string,
  payload: {
    name: string;
    description?: string;
    startDate: string;
    endDate: string;
  },
) {
  return (
    await request<{ roadmap: RoadmapSummary }>(base(organizationId), {
      method: "POST",
      body: JSON.stringify(payload),
    })
  ).roadmap;
}

export async function getRoadmap(
  organizationId: number | string,
  roadmapId: number,
  filters: RoadmapFilters,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  return request<RoadmapBundle>(
    `${base(organizationId)}/${roadmapId}?${query}`,
    { signal },
  );
}

export async function createRoadmapTask(
  organizationId: number | string,
  roadmapId: number,
  payload: Record<string, unknown>,
) {
  return (
    await request<{ task: RoadmapTask }>(
      `${base(organizationId)}/${roadmapId}/tasks`,
      { method: "POST", body: JSON.stringify(payload) },
    )
  ).task;
}

export async function updateRoadmapTask(
  organizationId: number | string,
  roadmapId: number,
  taskId: number,
  payload: Record<string, unknown>,
) {
  return (
    await request<{ task: RoadmapTask }>(
      `${base(organizationId)}/${roadmapId}/tasks/${taskId}`,
      { method: "PATCH", body: JSON.stringify(payload) },
    )
  ).task;
}

export async function deleteRoadmapTask(
  organizationId: number | string,
  roadmapId: number,
  taskId: number,
) {
  await request(`${base(organizationId)}/${roadmapId}/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export async function listTaskComments(
  organizationId: number | string,
  roadmapId: number,
  taskId: number,
) {
  return (
    await request<{ comments: RoadmapComment[] }>(
      `${base(organizationId)}/${roadmapId}/tasks/${taskId}/comments`,
    )
  ).comments || [];
}

export async function createTaskComment(
  organizationId: number | string,
  roadmapId: number,
  taskId: number,
  content: string,
) {
  return (
    await request<{ comments: RoadmapComment[] }>(
      `${base(organizationId)}/${roadmapId}/tasks/${taskId}/comments`,
      { method: "POST", body: JSON.stringify({ content }) },
    )
  ).comments || [];
}
