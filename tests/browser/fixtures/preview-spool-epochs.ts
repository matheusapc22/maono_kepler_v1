import { hashPreviewBlob } from '../../../src/pages/Kepler/thumbnail/preview-contract';
import * as spool from '../../../src/pages/Kepler/thumbnail/preview-spool';
import * as background from '../../../src/pages/Kepler/thumbnail/background-thumbnail-job';
import * as recovery from '../../../src/pages/Kepler/thumbnail/preview-recovery';
export { spool, background, recovery };

export async function record(actorId = 'actor-a', purgeEpoch?: number) {
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#335577'; ctx.fillRect(0, 0, 960, 540);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
  const manifest = { operationId: `pv2:${crypto.randomUUID()}`, saveOperationId: crypto.randomUUID(), organizationId: '7', projectId: '19', revision: 2,
    configChecksum: 'a'.repeat(64), editorSessionId: 'synthetic-editor', editGeneration: 1, rendererVersion: 'maono-png-v2',
    imageChecksum: await hashPreviewBlob(blob), sizeBytes: blob.size, captureMethod: 'canvas-composite' };
  const createdAt = Date.now();
  return { key: spool.previewSpoolKey(actorId, manifest), accountKey: spool.previewAccountKey(actorId, '7'), actorId, organizationId: '7', slug: 'synthetic', manifest, blob,
    createdAt, expiresAt: createdAt + spool.PREVIEW_SPOOL_RETENTION_MS, attempts: 0, nextAttemptAt: 0, lastError: null, state: 'LOCAL_READY' as const,
    ...(purgeEpoch === undefined ? {} : { purgeEpoch }) };
}
export function staged(value: Awaited<ReturnType<typeof record>>) {
  const record = value;
  const m = record.manifest;
  return { key: JSON.stringify([record.actorId, record.organizationId, m.saveOperationId]), actorId: record.actorId, organizationId: record.organizationId,
    saveOperationId: m.saveOperationId, editorSessionId: m.editorSessionId, editGeneration: m.editGeneration, rendererVersion: m.rendererVersion,
    imageChecksum: m.imageChecksum, captureMethod: m.captureMethod, blob: record.blob, createdAt: record.createdAt, expiresAt: record.expiresAt,
    ...(record.purgeEpoch === undefined ? {} : { purgeEpoch: record.purgeEpoch }) };
}
export function holdBlob(blob: Blob) {
  const read = blob.arrayBuffer.bind(blob); let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  Object.defineProperty(blob, 'arrayBuffer', { configurable: true, value: async () => { entered(); await gate; return read(); } });
  return { started, release };
}
export async function rawState(actorId = 'actor-a') {
  return new Promise<any>((resolve, reject) => {
    const opening = indexedDB.open(spool.PREVIEW_SPOOL_DATABASE);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, tx = db.transaction(['previews', 'staged', 'actor-epochs']);
      const previews = tx.objectStore('previews').index('actorId').getAll(actorId), staged = tx.objectStore('staged').index('actorId').getAll(actorId), actor = tx.objectStore('actor-epochs').get(actorId);
      tx.oncomplete = () => { db.close(); resolve({ version: db.version, previews: previews.result.length, staged: staged.result.length, epoch: actor.result?.purgeEpoch ?? 0 }); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
