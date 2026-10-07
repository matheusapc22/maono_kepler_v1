// Historical revision reader. Reservation/recycling/publication were replaced
// by the operation-owned immutable protocol in project-save-operations.js.
function getDb(env) {
  const db = env?.DB || env?.D1 || env?.MAONO_DB;
  if (!db?.prepare) throw Object.assign(new Error("Banco D1 não configurado."), {status:503, code:"DATABASE_NOT_CONFIGURED"});
  return db;
}

export async function getProjectConfigRevision(env, projectId, revision) {
  return getDb(env)
    .prepare(
      `SELECT *
       FROM project_config_revisions
      WHERE project_id = ? AND revision = ?
      LIMIT 1`,
    )
    .bind(projectId, revision)
    .first();
}
