/** Presentation-only timing. Requests must start independently and immediately. */
export const DEFAULT_INITIAL_STRUCTURE_DELAY_MS = 80;
export const DEFAULT_INITIAL_CONTENT_DELAY_MS = 260;
export const MAX_INITIAL_LOADING_DELAY_MS = 600;

export type InitialLoadingPresentationOptions = {
  pending: boolean;
  /** A usable, authorized snapshot for this scope, including an empty result. */
  hasData: boolean;
  /** Stable request/access scope. Never use a loading flag or response identity. */
  scopeKey: string | number;
  failed?: boolean;
  cancelled?: boolean;
  structureDelayMs?: number;
  /** Total time from the first pending render, not a delay after the response. */
  contentDelayMs?: number;
};

export type InitialLoadingPresentationInput = InitialLoadingPresentationOptions & {
  reducedMotion?: boolean;
};

export type InitialLoadingPresentation = {
  structurePending: boolean;
  contentPending: boolean;
};

type NormalizedInput = Required<InitialLoadingPresentationInput>;
export type InitialLoadingPresentationState = {
  input: NormalizedInput;
  phase: "idle" | "structure" | "content" | "complete";
  startedAt: number | null;
  structureDeadline: number;
  contentDeadline: number;
};

function boundedDelay(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value)
    ? Math.min(MAX_INITIAL_LOADING_DELAY_MS, Math.max(0, value))
    : fallback;
}

export function normalizeInitialLoadingDelays({
  structureDelayMs,
  contentDelayMs,
}: Pick<InitialLoadingPresentationOptions, "structureDelayMs" | "contentDelayMs"> = {}) {
  const content = boundedDelay(contentDelayMs, DEFAULT_INITIAL_CONTENT_DELAY_MS);
  return {
    structureDelayMs: Math.min(content, boundedDelay(structureDelayMs, DEFAULT_INITIAL_STRUCTURE_DELAY_MS)),
    contentDelayMs: content,
  };
}

function normalizeInput(input: InitialLoadingPresentationInput): NormalizedInput {
  return {
    ...input,
    ...normalizeInitialLoadingDelays(input),
    failed: Boolean(input.failed),
    cancelled: Boolean(input.cancelled),
    reducedMotion: Boolean(input.reducedMotion),
  };
}

function sameInput(left: NormalizedInput, right: NormalizedInput): boolean {
  return left.scopeKey === right.scopeKey && left.pending === right.pending &&
    left.hasData === right.hasData && left.failed === right.failed &&
    left.cancelled === right.cancelled && left.reducedMotion === right.reducedMotion &&
    left.structureDelayMs === right.structureDelayMs && left.contentDelayMs === right.contentDelayMs;
}

/** Pure state machine so cache, timing and cancellation are testable without React. */
export function advanceInitialLoadingPresentation(
  previous: InitialLoadingPresentationState | null,
  options: InitialLoadingPresentationInput,
  now: number,
): InitialLoadingPresentationState {
  const input = normalizeInput(options);
  const sameScope = previous !== null && previous.input.scopeKey === input.scopeKey;
  let phase = sameScope ? previous.phase : "idle";
  let startedAt = sameScope ? previous.startedAt : null;
  let structureDeadline = sameScope ? previous.structureDeadline : 0;
  let contentDeadline = sameScope ? previous.contentDeadline : 0;

  // Terminal/access states remove every artificial gate immediately. A later
  // retry in the same scope is real loading, never a second staged presentation.
  if (input.failed || input.cancelled || input.reducedMotion) {
    phase = "complete";
  } else if (phase === "idle") {
    if (input.hasData) {
      phase = "complete";
    } else if (input.pending) {
      startedAt = now;
      structureDeadline = now + input.structureDelayMs;
      contentDeadline = now + input.contentDelayMs;
      phase = "structure";
    }
  }

  if (phase === "structure" && now >= structureDeadline) phase = "content";
  if (phase === "content" && now >= contentDeadline) phase = "complete";

  if (sameScope && previous.phase === phase && previous.startedAt === startedAt &&
      previous.structureDeadline === structureDeadline && previous.contentDeadline === contentDeadline &&
      sameInput(previous.input, input)) return previous;
  return { input, phase, startedAt, structureDeadline, contentDeadline };
}

export function readInitialLoadingPresentation(state: InitialLoadingPresentationState): InitialLoadingPresentation {
  if (state.input.failed || state.input.cancelled) return { structurePending: false, contentPending: false };
  return {
    structurePending: state.phase === "structure",
    contentPending: state.phase === "structure" || state.phase === "content" ||
      (state.input.pending && !state.input.hasData),
  };
}

export type PresentationScheduler = {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

/** One deadline at a time; cleanup also makes an already-queued callback inert. */
export function scheduleInitialLoadingPresentation(
  state: InitialLoadingPresentationState,
  scheduler: PresentationScheduler,
  onDeadline: () => void,
): () => void {
  const deadline = state.phase === "structure" ? state.structureDeadline :
    state.phase === "content" ? state.contentDeadline : null;
  if (deadline === null) return () => {};
  let active = true;
  let timer: unknown;
  const onTimer = () => {
    if (!active) return;
    const remaining = deadline - scheduler.now();
    // Browser timers may fire just before a fractional performance.now()
    // deadline. Advancing then would return unchanged state, so React would
    // never rerun the effect. Keep ownership and rearm until the real deadline.
    if (remaining > 0) {
      timer = scheduler.setTimeout(onTimer, Math.max(1, Math.ceil(remaining)));
      return;
    }
    active = false;
    onDeadline();
  };
  timer = scheduler.setTimeout(onTimer, Math.max(0, Math.ceil(deadline - scheduler.now())));
  return () => {
    active = false;
    scheduler.clearTimeout(timer);
  };
}
