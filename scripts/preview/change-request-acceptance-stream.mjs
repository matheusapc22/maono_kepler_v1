import { assertLargeAcceptanceSize, previewOrigin } from '../operations/change-request-release-contracts.mjs';
import { dropboxContentHashHex } from '../../functions/_lib/dropbox-content-hash.js';

// Consume config-stream in the operator runner, never the legacy JSON endpoint
// that parses/materializes MapConfig in the Worker. No implicit retry.
export async function readAcceptanceConfig({ origin, slug, revision, cookie, fetcher = fetch }) {
  const response = await fetcher(`${previewOrigin(origin)}/api/projects/${encodeURIComponent(slug)}/config-stream`, {
    redirect: 'manual', cache: 'no-store',
    headers: { Cookie: cookie, 'X-Maono-Expected-Config-Revision': String(revision) },
  });
  if (!response.ok || response.headers.get('X-Maono-Runtime-Env') !== 'preview' ||
      response.headers.get('X-Maono-Config-Transport') !== 'stream' ||
      Number(response.headers.get('X-Maono-Config-Revision')) !== revision) {
    throw new Error('Acceptance config-stream identity/revision/transport mismatch');
  }
  const size = Number(response.headers.get('X-Maono-Config-Size'));
  assertLargeAcceptanceSize(size);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Acceptance config-stream body missing');
  const chunks = []; let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > size) throw new Error('Acceptance config-stream exceeds declared size');
      chunks.push(value);
    }
    if (received !== size) throw new Error('Acceptance config-stream truncated');
  } catch {
    await reader.cancel().catch(() => {});
    throw new Error('Acceptance config-stream failed; do not mask transport failure with retry');
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes, checksum: await dropboxContentHashHex(bytes) };
}
