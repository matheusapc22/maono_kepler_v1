// Immutable structural source for the already-reviewed 0042/0043/0044 profiles.
// This is not the current runtime/bootstrap, and cannot grant apply authority.
export const ORGANIZATION_SCHEMA_SNAPSHOT=Object.freeze({
  originalPath:'schema.sql',
  path:'scripts/migrations/references/organization-schema-pre-0045.sql',
  revision:'e1613ce803c5852f5eacb838f9f7d81c0a091ac7',
  sha256:'7016dbc64d6502af557bc9fd5cab9cc2be71770a1d56ff74d5c88219d61026fc',
  scope:'immutable structural baseline; current runtime sources remain separately pinned',
});
export function organizationHistoricalSourcePath(path) {
  return path===ORGANIZATION_SCHEMA_SNAPSHOT.originalPath?ORGANIZATION_SCHEMA_SNAPSHOT.path:path;
}
