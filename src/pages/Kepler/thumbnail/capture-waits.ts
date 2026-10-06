export function captureAbortError() {
  return new DOMException("Captura cancelada ou superada.", "AbortError");
}

export function throwIfCaptureAborted(signal: AbortSignal) {
  if (signal.aborted) throw captureAbortError();
}

/** Every asynchronous boundary settles on cancel/timeout, even if the browser
 * never invokes RAF/idle/toBlob/html2canvas. Late resources are disposed. */
export function boundedCaptureWait<T>(
  start: (resolve: (value: T) => void, reject: (reason: unknown) => void) => void | (() => void),
  signal: AbortSignal,
  timeoutMs: number,
  label: string,
  disposeLate?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    let release: void | (() => void);
    const finish = (error: unknown, value?: T) => {
      if (done) { if (!error && value !== undefined) disposeLate?.(value); return; }
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      release?.();
      if (error) reject(error); else resolve(value as T);
    };
    const abort = () => finish(captureAbortError());
    const timer = setTimeout(() => finish(new Error(`CAPTURE_TIMEOUT:${label}`)), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try {
      release = start((value) => finish(null, value), (error) => finish(error));
      if (done) release?.();
    } catch (error) { finish(error); }
  });
}

export function yieldCaptureTask(signal: AbortSignal) {
  return boundedCaptureWait<void>((resolve) => {
    const id = setTimeout(resolve, 0);
    return () => clearTimeout(id);
  }, signal, 1500, "task-yield");
}

export function captureAnimationFrame(signal: AbortSignal, timeoutMs = 1500) {
  return boundedCaptureWait<void>((resolve) => {
    const id = requestAnimationFrame(() => resolve());
    return () => cancelAnimationFrame(id);
  }, signal, timeoutMs, "animation-frame");
}
