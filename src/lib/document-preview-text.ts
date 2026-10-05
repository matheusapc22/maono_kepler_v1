export const MAX_PREVIEW_TEXT_CHARS = 100_000;
type TextChunk = { items?: readonly unknown[] };

/** WebKit supports readers before ReadableStream's async iterator. */
export async function readPreviewText(stream: ReadableStream<TextChunk>, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const reader = stream.getReader();
  // PDF.js requires an Error reason so its worker stream is marked closed.
  const cancellation = new Error("Preview text extraction cancelled.");
  const abort = () => { void reader.cancel(cancellation).catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  let text = "";
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) return text;
      const items = value && Array.isArray(value.items) ? value.items : [];
      for (const item of items) {
        if (!item || typeof item !== "object" || !("str" in item) || typeof item.str !== "string" || !item.str) continue;
        if (text) text += " ";
        text += item.str.slice(0, MAX_PREVIEW_TEXT_CHARS - text.length);
        if (text.length >= MAX_PREVIEW_TEXT_CHARS) return text;
      }
    }
  } finally {
    signal.removeEventListener("abort", abort);
    // Native cancel closes immediately; a stalled worker ack must not retain the lock.
    void reader.cancel(cancellation).catch(() => {});
    reader.releaseLock();
  }
}
