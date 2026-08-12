export const MAP_LOAD_EVENTS = Object.freeze([
  "MAP_OPEN_REQUESTED",
  "SESSION_RESOLVED",
  "PROJECT_RESOLVED",
  "LOAD_GUARD_STARTED",
  "CONFIG_REQUESTED",
  "CONFIG_VALIDATED",
  "MIGRATED",
  "ENGINE_HYDRATION_STARTED",
  "MAP_READY",
] as const);

export type MapLoadEventName = (typeof MAP_LOAD_EVENTS)[number];

export type MapLoadScalarId = string | number | null;

export type MapLoadEventRecord = {
  event: MapLoadEventName;
  correlationId: string;
  projectId: MapLoadScalarId;
  revision: number | null;
  schemaVersion: number | null;
  duration: number;
};

export const MAP_LOAD_EVENT_INDEX = Object.freeze(
  Object.fromEntries(
    MAP_LOAD_EVENTS.map((event, index) => [event, index]),
  ) as Record<MapLoadEventName, number>,
);

export function isMapLoadEventName(value: unknown): value is MapLoadEventName {
  return MAP_LOAD_EVENTS.includes(value as MapLoadEventName);
}
