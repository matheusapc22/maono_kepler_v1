import { parentPort, threadId, workerData } from 'node:worker_threads';
import { adminUsersFixture } from './admin-users-sqlite.mjs';
import { onRequestPost } from '../../functions/api/organizations/[id]/users.js';
import { onRequest as legacyMembership } from '../../functions/api/admin/organization-users/[id].js';

const f = await adminUsersFixture({ after() {} }, { databasePath: workerData.path, initialize: false });
const control = new Int32Array(workerData.barrier);
const permitIndex = workerData.userId + 1;
const executionIndex = workerData.userId + 3;
const report = (type, details = {}) => parentPort.postMessage({ type, userId: workerData.userId, threadId, ...details });
let ordinal;
f.env.ORGANIZATION_MANAGEMENT_V1 = workerData.flag;
f.beforeWrites(async () => {
  report('prepared');
  Atomics.wait(control, permitIndex, 0);
});
f.observeTransactions({
  beforeBegin() { report('begin-attempt'); },
  afterBegin() {
    // Record only a successfully acquired transaction, including a later rollback.
    ordinal = Atomics.add(control, 0, 1) + 1;
    if (ordinal > 2) throw new Error('Unexpected additional write transaction');
    Atomics.store(control, ordinal, workerData.userId);
    report('begin-acquired', { ordinal });
    if (workerData.controlled) Atomics.wait(control, executionIndex, 0);
  },
  afterEnd(outcome) { report('transaction-end', { ordinal, outcome }); },
});
try {
  const response = workerData.remove
    ? await legacyMembership({ env: f.env, request: f.request('DELETE'), params: { id: String(workerData.userId) } })
    : await onRequestPost({ env: f.env, request: f.request('POST', { email: workerData.userId === 2 ? 'a@example.test' : 'b@example.test', name: 'Committed synthetic profile', role: 'editor', accessLevel: 'viewer' }), params: { id: '1' } });
  report('response', { status: response.status, rawBody: await response.text() });
} finally {
  f.db.close();
}
