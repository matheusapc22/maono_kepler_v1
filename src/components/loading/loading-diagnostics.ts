import type {
  ActiveLoadingSnapshot,
  LoadingController,
} from "./loading-controller";

export const DEFAULT_LOADING_STALE_MS = 30_000;

export type LoadingStaleDiagnostic = Readonly<{
  event: "loading_token_stale";
  tokenId: number;
  label: ActiveLoadingSnapshot["label"];
  scope: ActiveLoadingSnapshot["scope"];
  surface: ActiveLoadingSnapshot["surface"];
  ageMs: number;
}>;

export function buildLoadingStaleDiagnostic(
  snapshot: ActiveLoadingSnapshot,
): LoadingStaleDiagnostic {
  return Object.freeze({
    event: "loading_token_stale",
    tokenId: snapshot.id,
    label: snapshot.label,
    scope: snapshot.scope,
    surface: snapshot.surface,
    ageMs: Math.max(0, Math.round(snapshot.ageMs)),
  });
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

type LoadingStaleObserverOptions = {
  staleAfterMs?: number;
  onStale: (diagnostic: LoadingStaleDiagnostic) => void;
  now?: () => number;
  setTimer?: (
    callback: () => void,
    milliseconds: number,
  ) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
};

export class LoadingStaleObserver {
  private readonly controller: LoadingController;
  private readonly options: LoadingStaleObserverOptions;
  private readonly emittedTokenIds = new Set<number>();
  private readonly staleAfterMs: number;
  private readonly now: () => number;
  private readonly setTimer: NonNullable<LoadingStaleObserverOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<LoadingStaleObserverOptions["clearTimer"]>;
  private timer: TimerHandle | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    controller: LoadingController,
    options: LoadingStaleObserverOptions,
  ) {
    this.controller = controller;
    this.options = options;
    this.staleAfterMs = Math.max(
      1,
      options.staleAfterMs ?? DEFAULT_LOADING_STALE_MS,
    );
    this.now = options.now ?? (() => Date.now());
    this.setTimer =
      options.setTimer ??
      ((callback, milliseconds) =>
        globalThis.setTimeout(callback, milliseconds));
    this.clearTimer =
      options.clearTimer ??
      ((handle) => globalThis.clearTimeout(handle));
  }

  start() {
    if (this.unsubscribe) {
      return;
    }

    this.unsubscribe = this.controller.subscribe(() => {
      this.schedule();
    });
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clearScheduledTimer();
    this.emittedTokenIds.clear();
  }

  private clearScheduledTimer() {
    if (this.timer === null) {
      return;
    }

    this.clearTimer(this.timer);
    this.timer = null;
  }

  private schedule() {
    this.clearScheduledTimer();

    const now = this.now();
    const active = this.controller.getActiveSnapshot(now);
    const activeIds = new Set(active.map((entry) => entry.id));

    for (const tokenId of Array.from(this.emittedTokenIds)) {
      if (!activeIds.has(tokenId)) {
        this.emittedTokenIds.delete(tokenId);
      }
    }

    let nextDelay: number | null = null;

    for (const entry of active) {
      if (this.emittedTokenIds.has(entry.id)) {
        continue;
      }

      const remaining = this.staleAfterMs - entry.ageMs;

      if (remaining <= 0) {
        this.emittedTokenIds.add(entry.id);
        this.options.onStale(buildLoadingStaleDiagnostic(entry));
        continue;
      }

      nextDelay =
        nextDelay === null
          ? remaining
          : Math.min(nextDelay, remaining);
    }

    if (nextDelay !== null) {
      this.timer = this.setTimer(
        () => {
          this.timer = null;
          this.schedule();
        },
        Math.max(1, nextDelay),
      );
    }
  }
}
