import {
  MAP_LOAD_EVENT_INDEX,
  MAP_LOAD_EVENTS,
  type MapLoadEventName,
  type MapLoadEventRecord,
  type MapLoadScalarId,
} from "./map-load-events";

export type MapLoadTraceError = {
  stage: MapLoadEventName | null;
  code: string | null;
  category: string | null;
  retryable: boolean | null;
  status: number | null;
};

export type MapLoadTracePayload = {
  correlationId: string;
  projectId: MapLoadScalarId;
  revision: number | null;
  schemaVersion: number | null;
  duration: number;
  status: "success" | "error" | "incomplete";
  events: MapLoadEventRecord[];
  error: MapLoadTraceError | null;
};

type TraceClock = () => number;

type TraceOptions = {
  correlationId?: string;
  now?: TraceClock;
  projectId?: MapLoadScalarId;
  revision?: number | null;
  schemaVersion?: number | null;
};

function defaultNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function createCorrelationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `corr-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function nonNegativeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function normalizeId(value: unknown): MapLoadScalarId {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
  return null;
}

function safeCode(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9_:-]{2,120}$/.test(normalized) ? normalized : null;
}

function safeCategory(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9_:-]{2,80}$/.test(normalized) ? normalized : null;
}

export class MapLoadTrace {
  readonly correlationId: string;
  readonly startedAt: number;
  private readonly now: TraceClock;
  private readonly records: MapLoadEventRecord[] = [];
  private projectId: MapLoadScalarId;
  private revision: number | null;
  private schemaVersion: number | null;
  private terminalError: MapLoadTraceError | null = null;
  private flushed = false;

  constructor(options: TraceOptions = {}) {
    this.correlationId = options.correlationId || createCorrelationId();
    this.now = options.now || defaultNow;
    this.startedAt = this.now();
    this.projectId = normalizeId(options.projectId);
    this.revision = nonNegativeInteger(options.revision);
    this.schemaVersion = nonNegativeInteger(options.schemaVersion);
  }

  updateContext({
    projectId,
    revision,
    schemaVersion,
  }: Partial<Pick<TraceOptions, "projectId" | "revision" | "schemaVersion">>) {
    const nextProjectId = normalizeId(projectId);
    const nextRevision = nonNegativeInteger(revision);
    const nextSchemaVersion = nonNegativeInteger(schemaVersion);

    if (nextProjectId !== null) this.projectId = nextProjectId;
    if (nextRevision !== null) this.revision = nextRevision;
    if (nextSchemaVersion !== null) this.schemaVersion = nextSchemaVersion;
  }

  has(event: MapLoadEventName) {
    return this.records.some((record) => record.event === event);
  }

  nextExpectedEvent(): MapLoadEventName | null {
    return MAP_LOAD_EVENTS[this.records.length] ?? null;
  }

  record(
    event: MapLoadEventName,
    context: Partial<Pick<TraceOptions, "projectId" | "revision" | "schemaVersion">> = {},
  ) {
    if (this.terminalError || this.flushed) return false;
    if (this.has(event)) return false;

    const expected = this.nextExpectedEvent();
    if (expected !== event) {
      if (typeof console !== "undefined") {
        console.warn("[Maono map load] Evento fora de ordem ignorado.", {
          correlationId: this.correlationId,
          expected,
          received: event,
        });
      }
      return false;
    }

    this.updateContext(context);
    const duration = Math.max(0, Math.round(this.now() - this.startedAt));
    this.records.push({
      event,
      correlationId: this.correlationId,
      projectId: this.projectId,
      revision: this.revision,
      schemaVersion: this.schemaVersion,
      duration,
    });
    return true;
  }

  fail(error: Partial<MapLoadTraceError> = {}) {
    if (this.flushed || this.terminalError || this.has("MAP_READY")) return false;
    this.terminalError = {
      stage: error.stage && MAP_LOAD_EVENT_INDEX[error.stage] !== undefined
        ? error.stage
        : this.nextExpectedEvent(),
      code: safeCode(error.code),
      category: safeCategory(error.category),
      retryable:
        typeof error.retryable === "boolean" ? error.retryable : null,
      status: nonNegativeInteger(error.status),
    };
    return true;
  }

  markFlushed() {
    this.flushed = true;
  }

  isFlushed() {
    return this.flushed;
  }

  isComplete() {
    return this.has("MAP_READY");
  }

  isFailed() {
    return Boolean(this.terminalError);
  }

  toPayload(): MapLoadTracePayload {
    const duration = Math.max(0, Math.round(this.now() - this.startedAt));
    return {
      correlationId: this.correlationId,
      projectId: this.projectId,
      revision: this.revision,
      schemaVersion: this.schemaVersion,
      duration,
      status: this.isComplete()
        ? "success"
        : this.terminalError
          ? "error"
          : "incomplete",
      events: this.records.map((record) => ({ ...record })),
      error: this.terminalError ? { ...this.terminalError } : null,
    };
  }
}

let activeTrace: MapLoadTrace | null = null;

export function startMapLoadTrace(options: TraceOptions = {}) {
  activeTrace = new MapLoadTrace(options);
  activeTrace.record("MAP_OPEN_REQUESTED");
  return activeTrace;
}

export function getActiveMapLoadTrace() {
  return activeTrace;
}

export function clearActiveMapLoadTrace(trace?: MapLoadTrace | null) {
  if (!trace || trace === activeTrace) activeTrace = null;
}

export function updateActiveMapLoadTraceContext(
  context: Partial<Pick<TraceOptions, "projectId" | "revision" | "schemaVersion">>,
) {
  activeTrace?.updateContext(context);
}

export function recordMapLoadEvent(
  event: MapLoadEventName,
  context: Partial<Pick<TraceOptions, "projectId" | "revision" | "schemaVersion">> = {},
) {
  const recorded = activeTrace?.record(event, context) ?? false;
  if (recorded && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("maono:map-load-event", {
        detail: { event, correlationId: activeTrace?.correlationId ?? null },
      }),
    );
  }
  return recorded;
}

export function failActiveMapLoadTrace(error: Partial<MapLoadTraceError> = {}) {
  const failed = activeTrace?.fail(error) ?? false;
  if (failed && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("maono:map-load-terminal", {
        detail: {
          status: "error",
          correlationId: activeTrace?.correlationId ?? null,
        },
      }),
    );
  }
  return failed;
}
