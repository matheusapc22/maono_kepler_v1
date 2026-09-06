import { getDb, tableExists } from './organizations.js';

export async function isChangeRequestResubmissionSchemaReady(env) {
  if (!(await tableExists(env, 'project_change_requests'))) return false;
  const db = getDb(env);
  const columns = await db.prepare('PRAGMA table_info(project_change_requests)').all();
  const names = new Set((columns?.results || []).map(column => column.name));
  if (!names.has('resubmitted_from_request_id')) return false;

  const objects = await db.prepare(`SELECT type, name FROM sqlite_master
    WHERE name IN (
      'uq_project_change_request_resubmission_source',
      'trg_project_change_request_resubmission_immutable',
      'trg_project_change_request_resubmission_guard'
    )`).all();
  const present = new Map((objects?.results || []).map(row => [row.name, row.type]));
  return present.get('uq_project_change_request_resubmission_source') === 'index' &&
    present.get('trg_project_change_request_resubmission_immutable') === 'trigger' &&
    present.get('trg_project_change_request_resubmission_guard') === 'trigger';
}
