import { getProjectConfigRevision } from "./project-config-revisions.js";
const fail = (code, status = 409) => {
  throw Object.assign(new Error(code), { code, status });
};
export async function bindApplyArtifact(context, input) {
  const checksum = String(input?.checksum || "").toLowerCase(),
    size = Number(input?.sizeBytes);
  if (
    !/^[a-f0-9]{64}$/.test(checksum) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 100 * 1024 * 1024
  )
    fail("CHANGE_REQUEST_APPLY_ARTIFACT_INVALID", 400);
  if (
    Number(input?.baseRevision) !== Number(context.row.base_revision) ||
    Number(input?.version) !== Number(context.row.lifecycle_version)
  )
    fail("CHANGE_REQUEST_REVIEW_STATE_CONFLICT");
  if (!["submitted", "under_review", "approved"].includes(context.row.status))
    fail("CHANGE_REQUEST_REVIEW_STATE_CONFLICT");
  await context.db
    .prepare(
      `INSERT INTO project_change_request_apply_artifacts(change_request_id,checksum,size_bytes,base_revision,approved_by)
 SELECT id,?,?,base_revision,? FROM project_change_requests WHERE id=? AND lifecycle_version=? AND status IN ('submitted','under_review','approved') ON CONFLICT(change_request_id) DO NOTHING`,
    )
    .bind(
      checksum,
      size,
      context.user.id,
      context.row.id,
      context.row.lifecycle_version,
    )
    .run();
  const claimed = await context.db
    .prepare(
      "SELECT * FROM project_change_request_apply_artifacts WHERE change_request_id=?",
    )
    .bind(context.row.id)
    .first();
  if (!claimed || claimed.checksum !== checksum || claimed.size_bytes !== size)
    fail("CHANGE_REQUEST_APPLY_ARTIFACT_CONFLICT");
  return claimed;
}
export async function readApplyArtifact(context, request) {
  const row = await context.db
    .prepare(
      "SELECT * FROM project_change_request_apply_artifacts WHERE change_request_id=?",
    )
    .bind(context.row.id)
    .first();
  if (!row) fail("CHANGE_REQUEST_APPROVED_ARTIFACT_REQUIRED");
  if (
    request.headers.get("X-Maono-Config-Checksum") !== row.checksum ||
    Number(request.headers.get("X-Maono-Config-Size")) !== row.size_bytes ||
    Number(request.headers.get("X-Maono-Expected-Revision")) !==
      row.base_revision
  )
    fail("CHANGE_REQUEST_APPLY_ARTIFACT_CONFLICT");
  return { checksum: row.checksum, sizeBytes: row.size_bytes };
}
// Use immutable revision ledger, not the current project head. A later edit cannot
// make a retry claim someone else's revision or forget its original publication.
export async function recoverAppliedArtifact(env, context) {
  if (context.row.status !== "applying") return null;
  const artifact = await context.db
    .prepare(
      "SELECT * FROM project_change_request_apply_artifacts WHERE change_request_id=?",
    )
    .bind(context.row.id)
    .first();
  if (!artifact) return null;
  const revision = await getProjectConfigRevision(
    env,
    context.project.id,
    Number(context.row.base_revision) + 1,
  );
  if (
    !revision ||
    revision.status !== "READY" ||
    !revision.published_at ||
    revision.transition_id !== `cc08:${context.row.id}` ||
    revision.checksum !== artifact.checksum ||
    Number(revision.size_bytes) !== artifact.size_bytes
  )
    return null;
  // READY alone is not publication: head must have reached this revision.
  if (
    Number(context.project.config_revision) <
    Number(context.row.base_revision) + 1
  )
    return null;
  return { revision: Number(context.row.base_revision) + 1 };
}
