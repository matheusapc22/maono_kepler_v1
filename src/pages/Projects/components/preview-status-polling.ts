import { fetchProjectThumbnailStatus, ProjectThumbnailRequestError, type ProjectThumbnailState } from "../../Kepler/thumbnail/thumbnail-api";

type Subscriber = (state: ProjectThumbnailState) => void;
type Entry = { slug: string; listeners: Set<Subscriber>; controller: AbortController; timer?: ReturnType<typeof setTimeout>; failures: number; delay: number; running: boolean; state?: ProjectThumbnailState };
const entries = new Map<string, Entry>();
let inFlight = 0;
export function isPreviewGenerationActive(jobState?: string | null) {
  return !jobState || ["CAPTURING", "LOCAL_READY", "RECEIVING", "PAYLOAD_STORED", "PROCESSING", "RETRY_WAIT"].includes(jobState);
}
/** One authenticated status stream per identity, shared by all three card sections. */
export function subscribePreviewStatus(key: string, slug: string, listener: Subscriber, initialJobState?: string | null) {
  let entry = entries.get(key);
  if (!entry) {
    entry = { slug, listeners: new Set(), controller: new AbortController(), failures: 0, delay: initialJobState === "WAITING_CAPTURE" ? 15_000 : 2000, running: false };
    entries.set(key, entry);
  }
  const current = entry;
  current.listeners.add(listener);
  if (current.state) listener(current.state);
  const schedule = () => {
    if (current.controller.signal.aborted || !current.listeners.size || current.timer || current.running) return;
    current.timer = setTimeout(() => { current.timer = undefined; void poll(); }, current.delay);
  };
  const poll = async () => {
    if (current.controller.signal.aborted || !current.listeners.size) return;
    if (document.visibilityState === "hidden" || inFlight >= 4) { schedule(); return; }
    current.running = true; inFlight++;
    let keepPolling = true;
    try {
      const state = await fetchProjectThumbnailStatus(current.slug, current.controller.signal);
      if (current.controller.signal.aborted) return;
      current.state = state; current.failures = 0;
      for (const callback of current.listeners) callback(state);
      keepPolling = state.thumbnailStatus === "PENDING" && !["FAILED_FINAL", "SUPERSEDED"].includes(state.jobState || "");
      current.delay = state.jobState === "WAITING_CAPTURE" ? 30_000 : Math.min(15_000, Math.max(2000, current.delay * 1.5));
    } catch (error) {
      if (current.controller.signal.aborted) return;
      current.failures++;
      if (error instanceof ProjectThumbnailRequestError && [401, 403, 404].includes(error.status)) keepPolling = false;
      current.delay = Math.max(error instanceof ProjectThumbnailRequestError ? error.retryAfterMs : 0, Math.min(60_000, 2000 * 2 ** Math.min(current.failures, 5)));
    } finally {
      current.running = false; inFlight--;
      if (keepPolling) schedule();
    }
  };
  schedule();
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size) { current.controller.abort(); clearTimeout(current.timer); entries.delete(key); }
  };
}

export function clearPreviewStatusSubscriptions() {
  for (const entry of entries.values()) { entry.controller.abort(); clearTimeout(entry.timer); }
  entries.clear();
}
