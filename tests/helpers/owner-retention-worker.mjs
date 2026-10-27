import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(workerData.path);
db.exec('PRAGMA busy_timeout=5000');
parentPort.postMessage('ready');
Atomics.wait(new Int32Array(workerData.barrier), 0, 0);
try {
  const result = db.prepare(workerData.sql).run(...workerData.args);
  parentPort.postMessage({ changes: Number(result.changes) });
} finally { db.close(); }
