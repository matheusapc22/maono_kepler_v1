import { expect, type Page } from '@playwright/test';
import { validatePreviewPng } from '../../../functions/_lib/project-preview-png.js';
import { normalizePreviewManifest } from '../../../functions/_lib/project-preview-operations.js';
import { installLocalHttpRoute } from './local-http-route';

// Synthetic domain responses; the mounted renderer, PNG encoder, IndexedDB,
// browser upload bytes and shared server PNG validation remain real.
export async function installPanelPreview(page: Page, input: {
  projectPath: string;
  revision: () => number;
  savedOperation: (id: string) => Record<string, any> | undefined;
}) {
  const root = `${input.projectPath}/thumbnail`;
  const manifests: Record<string, any>[] = [];
  const uploads: { manifest: Record<string, any>; bytes: Buffer; receipt: Record<string, any> }[] = [];
  const operations = new Map<string, Record<string, any>>();
  const checks: { operationId: string; attempts: number }[] = [];
  const heldReadyStatuses: string[] = [];
  let currentOperationId: string | null = null;
  let uploadStatus = 200;
  let nextUploadGate: Promise<void> | undefined;
  let readyStatusGate: { operationId?: string; promise: Promise<void> } | undefined;
  let attempts = 0;
  const publicOperation = (operation: Record<string, any>) => ({ ok: true, operation: {
    operationId: operation.manifest.operationId, state: operation.state,
    payloadStored: Boolean(operation.receipt), receipt: operation.receipt ?? null,
  } });
  await installLocalHttpRoute(page, url => url.pathname === root || url.pathname === `${root}/status`, async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const id = url.searchParams.get('operationId');
    const operation = id ? operations.get(id) : undefined;
    if (method === 'GET' && url.pathname === `${root}/status`) {
      if (id) {
        checks.push({ operationId: id, attempts });
        if (operation?.state === 'READY' && readyStatusGate && (!readyStatusGate.operationId || readyStatusGate.operationId === id)) {
          if (!readyStatusGate.operationId) { readyStatusGate.operationId = id; heldReadyStatuses.push(id); }
          await readyStatusGate.promise;
        }
        return operation ? route.fulfill({ json: publicOperation(operation) })
          : route.fulfill({ status: 404, json: { ok: false, error: { code: 'PROJECT_PREVIEW_OPERATION_NOT_FOUND' } } });
      }
      const last = uploads.at(-1);
      const current = currentOperationId ? operations.get(currentOperationId) : null;
      return route.fulfill({ json: { ok: true, configRevision: input.revision(),
        thumbnailRevision: last?.receipt.revision ?? null, artifactId: last?.receipt.artifactId ?? null,
        thumbnailStatus: last?.receipt.revision === input.revision() ? 'READY' : 'PENDING',
        jobState: current?.manifest.revision === input.revision() ? current.state : 'WAITING_CAPTURE', thumbnailAttempts: attempts,
      } });
    }
    if (method === 'POST' && url.pathname === root) {
      const manifest = normalizePreviewManifest(request.postDataJSON());
      const saved = input.savedOperation(manifest.saveOperationId);
      expect(saved?.state).toBe('PUBLISHED');
      expect(String(manifest.organizationId)).toBe('1'); expect(String(manifest.projectId)).toBe('1');
      expect(manifest.revision).toBe(saved!.receipt.publishedRevision);
      expect(manifest.configChecksum).toBe(saved!.receipt.checksum);
      expect(manifest.rendererVersion).toBe('maono-png-v2');
      expect(manifest.editorSessionId).toEqual(expect.any(String));
      expect(Number.isSafeInteger(manifest.editGeneration) && manifest.editGeneration >= 0).toBe(true);
      const previous = operations.get(manifest.operationId);
      if (previous) { expect(previous.manifest).toEqual(manifest); return route.fulfill({ status: 201, json: publicOperation(previous) }); }
      if (manifest.revision !== input.revision()) return route.fulfill({ status: 409, json: { ok: false, error: { code: 'PROJECT_PREVIEW_SUPERSEDED' } } });
      const created = { manifest, state: 'WAITING_CAPTURE' };
      manifests.push(manifest); operations.set(manifest.operationId, created);
      currentOperationId = manifest.operationId;
      return route.fulfill({ status: 201, json: publicOperation(created) });
    }
    if (method === 'PUT' && url.pathname === root && operation) {
      if (operation.state === 'RECEIVING') return route.fulfill({ status: 409, json: { ok: false, error: { code: 'PROJECT_PREVIEW_UPLOAD_BUSY' } } });
      if (operation.state !== 'WAITING_CAPTURE') return route.fulfill({ status: operation.state === 'SUPERSEDED' ? 409 : 200, json: publicOperation(operation) });
      const superseded = () => operation.manifest.revision !== input.revision() || currentOperationId !== operation.manifest.operationId;
      if (superseded()) { operation.state = 'SUPERSEDED'; return route.fulfill({ status: 409, json: publicOperation(operation) }); }
      attempts += 1;
      if (uploadStatus !== 200) return route.fulfill({ status: uploadStatus, json: { ok: false, error: { code: 'PROJECT_PREVIEW_STORAGE_UNAVAILABLE' } } });
      operation.state = 'RECEIVING';
      const gate = nextUploadGate; nextUploadGate = undefined;
      if (gate) await gate;
      expect(request.headers()['content-type']).toBe('image/png');
      const bytes = request.postDataBuffer()!;
      let verified;
      try { verified = await validatePreviewPng(bytes); }
      catch (error: any) {
        operation.state = 'FAILED_FINAL';
        return route.fulfill({ status: Number(error.status || 422), json: { ok: false, error: { code: error.code } } });
      }
      expect(verified.width).toBe(960); expect(verified.height).toBe(540);
      expect(verified.sizeBytes).toBe(operation.manifest.sizeBytes);
      expect(verified.imageChecksum).toBe(operation.manifest.imageChecksum);
      if (superseded()) { operation.state = 'SUPERSEDED'; return route.fulfill({ status: 409, json: publicOperation(operation) }); }
      const receipt = { ...operation.manifest, artifactId: `synthetic:${operation.manifest.operationId}`, committedAt: new Date().toISOString() };
      operation.state = 'READY'; operation.receipt = receipt;
      uploads.push({ manifest: operation.manifest, bytes, receipt });
      return route.fulfill({ json: publicOperation(operation) });
    }
    if (method === 'GET' && url.pathname === root) {
      const uploaded = uploads.find(value => value.receipt.artifactId === url.searchParams.get('artifactId'));
      return uploaded ? route.fulfill({ contentType: 'image/png', body: uploaded.bytes, headers: {
        'X-Maono-Thumbnail-Revision': String(uploaded.receipt.revision), 'X-Maono-Thumbnail-Artifact': uploaded.receipt.artifactId,
        ETag: `"png-${uploaded.receipt.imageChecksum}"`, 'Cache-Control': 'private, no-cache', Vary: 'Cookie, Authorization',
      } }) : route.fulfill({ status: 404 });
    }
    throw new Error(`Unexpected preview fixture request: ${method} ${url.pathname}`);
  });
  return { manifests, uploads, checks, heldReadyStatuses, get attempts() { return attempts; }, rejectUploads(status: number) { uploadStatus = status; },
    operationState(id: string) { return operations.get(id)?.state; },
    holdNextUpload() { let release!: () => void; nextUploadGate = new Promise<void>(resolve => { release = resolve; }); return release; },
    holdNextReadyStatus() {
      let release!: () => void;
      const gate = { promise: new Promise<void>(resolve => { release = resolve; }) };
      readyStatusGate = gate;
      return () => { if (readyStatusGate === gate) readyStatusGate = undefined; release(); };
    },
  };
}
