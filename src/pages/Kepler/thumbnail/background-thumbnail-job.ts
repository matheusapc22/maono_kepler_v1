import {
  captureProjectThumbnail,
  type ProjectThumbnailCapture,
} from "./capture-thumbnail";
import {
  fetchProjectThumbnailStatus,
  markProjectThumbnailFailed,
  ProjectThumbnailRequestError,
  type ProjectThumbnailStatus,
  uploadProjectThumbnail,
} from "./thumbnail-api";

const RETRY_DELAYS_MS = [800, 1800, 3600];
const STATUS_DELAYS_MS = [2000, 4000, 8000, 15000];
const JOB_STORAGE_PREFIX = "maono.preview.job";

export type ProjectThumbnailJobState =
  | "QUEUED"
  | "CAPTURING"
  | "UPLOADING"
  | "PENDING"
  | "READY"
  | "FAILED"
  | "STALE"
  | "CANCELLED";

type ProjectThumbnailJobInput = {
  slug: string;
  organizationId: string | number;
  revision: number;
  mapState: any;
  savedConfig: any;
  onState?: (
    state: ProjectThumbnailJobState,
    detail?: { status?: ProjectThumbnailStatus; errorCode?: string },
  ) => void;
};

type ActiveJob = {
  revision: number;
  controller: AbortController;
  promise: Promise<ProjectThumbnailJobState>;
};

const activeJobs = new Map<string, ActiveJob>();

function jobKey(input: Pick<ProjectThumbnailJobInput, "organizationId" | "slug">) {
  return `${String(input.organizationId)}:${input.slug}`;
}

function storageKey(input: ProjectThumbnailJobInput) {
  return `${JOB_STORAGE_PREFIX}:${jobKey(input)}`;
}

function persistJobMetadata(
  input: ProjectThumbnailJobInput,
  state: ProjectThumbnailJobState,
) {
  try {
    if (["READY", "FAILED", "STALE", "CANCELLED"].includes(state)) {
      window.sessionStorage.removeItem(storageKey(input));
      return;
    }

    // Somente metadados de retomada. O config, GeoJSON e PNG nunca são
    // persistidos no navegador.
    window.sessionStorage.setItem(
      storageKey(input),
      JSON.stringify({
        slug: input.slug,
        organizationId: input.organizationId,
        revision: input.revision,
        state,
        updatedAt: Date.now(),
      }),
    );
  } catch {
    // Restrições de storage não podem interromper o salvamento.
  }
}

function emitMetric(
  name: string,
  detail: Record<string, unknown>,
) {
  window.dispatchEvent(
    new CustomEvent("maono:preview-metric", {
      detail: { name, ...detail },
    }),
  );
}

function notify(
  input: ProjectThumbnailJobInput,
  state: ProjectThumbnailJobState,
  detail?: { status?: ProjectThumbnailStatus; errorCode?: string },
) {
  persistJobMetadata(input, state);
  input.onState?.(state, detail);
}

function wait(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Job cancelado.", "AbortError"));
      return;
    }

    const timer = window.setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Job cancelado.", "AbortError"));
      },
      { once: true },
    );
  });
}

function waitForIdle(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Job cancelado.", "AbortError"));
      return;
    }

    const finish = () => {
      if (signal.aborted) {
        reject(new DOMException("Job cancelado.", "AbortError"));
      } else {
        resolve();
      }
    };

    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(finish, { timeout: 1000 });
      signal.addEventListener(
        "abort",
        () => window.cancelIdleCallback(id),
        { once: true },
      );
      return;
    }

    const id = globalThis.setTimeout(finish, 0);
    signal.addEventListener(
      "abort",
      () => globalThis.clearTimeout(id),
      { once: true },
    );
  });
}

function errorCode(error: unknown) {
  if (error instanceof ProjectThumbnailRequestError) {
    return error.code;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return "ABORTED";
  }

  return "CLIENT_CAPTURE_FAILED";
}

async function uploadWithRetry(
  input: ProjectThumbnailJobInput,
  capture: ProjectThumbnailCapture,
  signal: AbortSignal,
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await uploadProjectThumbnail({
        slug: input.slug,
        revision: input.revision,
        blob: capture.blob,
        captureMethod: capture.method,
        signal,
      });
    } catch (error) {
      lastError = error;

      if (
        !(error instanceof ProjectThumbnailRequestError) ||
        error.stale ||
        !error.retryable ||
        attempt === RETRY_DELAYS_MS.length
      ) {
        throw error;
      }

      const jitter = Math.floor(Math.random() * 250);
      await wait(RETRY_DELAYS_MS[attempt] + jitter, signal);
    }
  }

  throw lastError;
}

async function pollUntilTerminal(
  input: ProjectThumbnailJobInput,
  signal: AbortSignal,
) {
  for (const delayMs of STATUS_DELAYS_MS) {
    await wait(delayMs, signal);
    const state = await fetchProjectThumbnailStatus(input.slug, signal);

    if (state.configRevision !== input.revision) {
      return "STALE" as const;
    }

    if (state.thumbnailStatus === "READY") {
      return "READY" as const;
    }

    if (
      state.thumbnailStatus === "FAILED" ||
      state.thumbnailStatus === "MISSING"
    ) {
      return "FAILED" as const;
    }
  }

  return "PENDING" as const;
}

async function runJob(
  input: ProjectThumbnailJobInput,
  controller: AbortController,
) {
  const startedAt = performance.now();
  let captureMethod = "unknown";

  try {
    notify(input, "QUEUED");
    await waitForIdle(controller.signal);
    notify(input, "CAPTURING");

    const captureStartedAt = performance.now();
    const capture = await captureProjectThumbnail(
      input.mapState,
      input.savedConfig,
      { signal: controller.signal },
    );
    captureMethod = capture.method;
    emitMetric("capture_duration_ms", {
      slug: input.slug,
      revision: input.revision,
      value: performance.now() - captureStartedAt,
      method: capture.method,
    });

    const uploadStartedAt = performance.now();

    for (let cycle = 0; cycle < 3; cycle += 1) {
      notify(input, "UPLOADING");
      const accepted = await uploadWithRetry(
        input,
        capture,
        controller.signal,
      );

      if (accepted.status === "READY") {
        notify(input, "READY", { status: "READY" });
        emitMetric("upload_duration_ms", {
          slug: input.slug,
          revision: input.revision,
          value: performance.now() - uploadStartedAt,
          method: capture.method,
          cycles: cycle + 1,
        });
        return "READY";
      }

      notify(input, "PENDING", { status: "PENDING" });
      const terminal = await pollUntilTerminal(
        input,
        controller.signal,
      );

      if (terminal === "FAILED" && cycle < 2) {
        const jitter = Math.floor(Math.random() * 250);
        await wait(RETRY_DELAYS_MS[cycle] + jitter, controller.signal);
        continue;
      }

      emitMetric("upload_duration_ms", {
        slug: input.slug,
        revision: input.revision,
        value: performance.now() - uploadStartedAt,
        method: capture.method,
        cycles: cycle + 1,
      });
      notify(input, terminal, {
        status: terminal === "STALE" ? "PENDING" : terminal,
      });
      return terminal;
    }

    notify(input, "FAILED", { status: "FAILED" });
    return "FAILED";
  } catch (error) {
    if (controller.signal.aborted) {
      notify(input, "CANCELLED");
      return "CANCELLED";
    }

    if (
      error instanceof ProjectThumbnailRequestError &&
      error.stale
    ) {
      notify(input, "STALE", { errorCode: error.code });
      return "STALE";
    }

    const code = errorCode(error);

    try {
      await markProjectThumbnailFailed({
        slug: input.slug,
        revision: input.revision,
        captureMethod,
        errorCode: code,
        signal: controller.signal,
      });
    } catch (markError) {
      if (
        markError instanceof ProjectThumbnailRequestError &&
        markError.stale
      ) {
        notify(input, "STALE", { errorCode: markError.code });
        return "STALE";
      }
    }

    notify(input, "FAILED", { errorCode: code });
    return "FAILED";
  } finally {
    emitMetric("thumbnail_total_ms", {
      slug: input.slug,
      revision: input.revision,
      value: performance.now() - startedAt,
      method: captureMethod,
    });
  }
}

export function enqueueProjectThumbnailJob(
  input: ProjectThumbnailJobInput,
) {
  const key = jobKey(input);
  const existing = activeJobs.get(key);

  if (existing) {
    if (existing.revision === input.revision) {
      return existing.promise;
    }

    existing.controller.abort();
  }

  const controller = new AbortController();
  const promise = runJob(input, controller).finally(() => {
    const current = activeJobs.get(key);

    if (current?.controller === controller) {
      activeJobs.delete(key);
    }
  });

  activeJobs.set(key, {
    revision: input.revision,
    controller,
    promise,
  });

  return promise;
}

export function cancelProjectThumbnailJob(
  organizationId: string | number,
  slug: string,
) {
  const key = jobKey({ organizationId, slug });
  activeJobs.get(key)?.controller.abort();
}
