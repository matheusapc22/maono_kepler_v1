import { getDb, tableExists } from './organizations.js';

export async function isChangeRequestResubmissionSchemaReady(env) {
  if (!(await tableExists(env, 'project_change_requests'))) return false;
  const db = getDb(env);
  const column = await db.prepare(`SELECT COUNT(*) AS count
    FROM pragma_table_info('project_change_requests')
    WHERE name='resubmitted_from_request_id'`).first();
  if (Number(column?.count) !== 1) return false;

  const objects = await db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
    WHERE (type='index' AND name='uq_project_change_request_resubmission_source')
       OR (type='trigger' AND name='trg_project_change_request_resubmission_immutable')
       OR (type='trigger' AND name='trg_project_change_request_resubmission_guard')`).first();
  return Number(objects?.count) === 3;
}
