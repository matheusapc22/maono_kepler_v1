import assert from 'node:assert/strict';

// Exact inverse of the separately authorized thumbnail reliability fix. The
// original Project Pages hashes remain pinned; unrelated changes still fail.
const changes = {
  'src/pages/Projects/components/project-preview-presentation.mjs': [{
    before: '  if (normalizedStatus === "UNKNOWN") {\n    if (imageError || !hasCurrentImage) {\n      return "missing-neutral";',
    after: '  if (normalizedStatus === "UNKNOWN") {\n    if (imageError || !hasCurrentImage) {\n      // Image errors also include expired sessions, temporary storage failures\n      // and decode failures. They do not establish that no preview exists.\n      return "failed-neutral";',
  }],
  'src/pages/Projects/components/project-card-utils.ts': [{
    before: '    status === "READY"\n      ? project.thumbnailRevision\n      : project.configRevision ?? 0;',
    after: '    status === "READY"\n      ? project.thumbnailRevision\n      : 0;',
  }, {
    before: '    status === "READY"\n      ? project.thumbnailRevision\n      : project.configRevision;\n  const normalized = Number(revision);',
    after: '    status === "READY"\n      ? project.thumbnailRevision\n      : status === "UNKNOWN"\n        ? 0\n        : project.configRevision;\n  if (revision === null || revision === undefined) {\n    return null;\n  }\n  const normalized = Number(revision);',
  }, {
    before: 'export function projectPreviousReadyThumbnailUrl(\n  project: ProjectListItem,\n) {\n  const revision = Number(project.thumbnailRevision);',
    after: 'export function projectPreviousReadyThumbnailUrl(\n  project: ProjectListItem,\n) {\n  if (project.thumbnailRevision === null || project.thumbnailRevision === undefined) {\n    return null;\n  }\n  const revision = Number(project.thumbnailRevision);',
  }],
};

export function restoreApprovedThumbnailReliability(path, source) {
  for (const { before, after } of changes[path] ?? []) {
    assert.equal(source.split(after).length - 1, 1, `exact approved thumbnail edit: ${path}`);
    source = source.replace(after, before);
  }
  return source;
}
