import { interpolateViewport } from "./map-navigation.ts";
import type { MapViewportSummary } from "./types.ts";

export type MapFlightCancelReason =
  | "manual"
  | "interaction"
  | "context-change"
  | "loading"
  | "save"
  | "unmount"
  | "error";

export type MapFlightSnapshot = {
  active: boolean;
  startedAt: number | null;
  progress: number;
  start: MapViewportSummary | null;
  target: MapViewportSummary | null;
};

type Scheduler = {
  now(): number;
  request(callback: (time: number) => void): number;
  cancel(id: number): void;
};

type MapFlightControllerOptions = {
  scheduler?: Scheduler;
  onFrame(viewport: MapViewportSummary): void;
  onStateChange(snapshot: MapFlightSnapshot): void;
  onComplete?(target: MapViewportSummary): void;
  onCancel?(reason: MapFlightCancelReason): void;
  onError?(error: unknown): void;
};

const browserScheduler: Scheduler = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
};

const INITIAL_SNAPSHOT: MapFlightSnapshot = {
  active: false,
  startedAt: null,
  progress: 0,
  start: null,
  target: null,
};

export class MapFlightController {
  private readonly scheduler: Scheduler;
  private readonly onFrame: MapFlightControllerOptions["onFrame"];
  private readonly onStateChange: MapFlightControllerOptions["onStateChange"];
  private readonly onComplete?: MapFlightControllerOptions["onComplete"];
  private readonly onCancel?: MapFlightControllerOptions["onCancel"];
  private readonly onError?: MapFlightControllerOptions["onError"];
  private frameId: number | null = null;
  private durationMs = 0;
  private snapshot: MapFlightSnapshot = INITIAL_SNAPSHOT;

  constructor(options: MapFlightControllerOptions) {
    this.scheduler = options.scheduler ?? browserScheduler;
    this.onFrame = options.onFrame;
    this.onStateChange = options.onStateChange;
    this.onComplete = options.onComplete;
    this.onCancel = options.onCancel;
    this.onError = options.onError;
  }

  get state() {
    return this.snapshot;
  }

  start(
    start: MapViewportSummary,
    target: MapViewportSummary,
    durationMs: number,
  ) {
    if (this.snapshot.active) {
      return false;
    }

    const duration = Math.max(0, Number(durationMs) || 0);
    const startedAt = this.scheduler.now();
    this.durationMs = duration;
    this.snapshot = {
      active: true,
      startedAt,
      progress: 0,
      start: { ...start },
      target: { ...target },
    };
    this.onStateChange(this.snapshot);

    if (duration === 0) {
      this.finish();
      return true;
    }

    this.frameId = this.scheduler.request(this.animate);
    return true;
  }

  cancel(reason: MapFlightCancelReason = "manual") {
    if (!this.snapshot.active) return false;

    if (this.frameId !== null) {
      this.scheduler.cancel(this.frameId);
      this.frameId = null;
    }
    this.snapshot = {
      ...INITIAL_SNAPSHOT,
      progress: this.snapshot.progress,
    };
    this.onStateChange(this.snapshot);
    this.onCancel?.(reason);
    return true;
  }

  finish() {
    if (!this.snapshot.active || !this.snapshot.target) return false;

    if (this.frameId !== null) {
      this.scheduler.cancel(this.frameId);
      this.frameId = null;
    }

    const target = { ...this.snapshot.target };
    try {
      this.onFrame(target);
      this.snapshot = {
        ...INITIAL_SNAPSHOT,
        progress: 1,
      };
      this.onStateChange(this.snapshot);
      this.onComplete?.(target);
      return true;
    } catch (error) {
      this.snapshot = INITIAL_SNAPSHOT;
      this.onStateChange(this.snapshot);
      this.onError?.(error);
      return false;
    }
  }

  dispose(reason: MapFlightCancelReason = "unmount") {
    this.cancel(reason);
  }

  private readonly animate = (time: number) => {
    const { start, target, startedAt } = this.snapshot;
    if (!this.snapshot.active || !start || !target || startedAt === null) {
      return;
    }

    const progress = Math.min(
      1,
      Math.max(0, (time - startedAt) / this.durationMs),
    );

    try {
      this.onFrame(interpolateViewport(start, target, progress));
      this.snapshot = {
        ...this.snapshot,
        progress,
      };
      this.onStateChange(this.snapshot);

      if (progress >= 1) {
        this.frameId = null;
        this.snapshot = {
          ...INITIAL_SNAPSHOT,
          progress: 1,
        };
        this.onStateChange(this.snapshot);
        this.onComplete?.({ ...target });
        return;
      }

      this.frameId = this.scheduler.request(this.animate);
    } catch (error) {
      this.frameId = null;
      this.snapshot = INITIAL_SNAPSHOT;
      this.onStateChange(this.snapshot);
      this.onError?.(error);
    }
  };
}
