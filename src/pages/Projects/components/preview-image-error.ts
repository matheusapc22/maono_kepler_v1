export type PreviewImageErrorCause = "network" | "session" | "permission" | "missing" | "invalid-image" | "decode" | "timeout" | "unverified";
/** A failed <img> does not establish missing bytes. Probe only that failure with an authenticated readonly GET. */
export async function inspectPreviewImageFailure(url: string, signal?: AbortSignal, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis), timeoutMs = 10_000): Promise<PreviewImageErrorCause> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  let settleAbort!: (value: PreviewImageErrorCause) => void;
  const cancelled = new Promise<PreviewImageErrorCause>(resolve => { settleAbort = resolve; });
  const abort = () => { controller.abort(); settleAbort("unverified"); }; signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = new Promise<PreviewImageErrorCause>(resolve => { timer = setTimeout(() => { controller.abort(); resolve("timeout"); }, timeoutMs); });
  const read = async (): Promise<PreviewImageErrorCause> => {
    try {
      const response = await fetchImpl(url, { credentials: "include", cache: "no-store", signal: controller.signal });
      if (response.ok) { await response.body?.cancel(); return "unverified"; }
      if (response.status === 401) { await response.body?.cancel(); return "session"; }
      if (response.status === 403) { await response.body?.cancel(); return "permission"; }
      if ([413, 415, 422].includes(response.status)) { await response.body?.cancel(); return "invalid-image"; }
      const value = await response.json().catch(() => null);
      return response.status === 404 && value?.error?.code === "PROJECT_THUMBNAIL_NOT_FOUND" ? "missing" : "unverified";
    } catch { return signal?.aborted ? "unverified" : "network"; }
  };
  try { return await Promise.race([read(), timeout, cancelled]); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
