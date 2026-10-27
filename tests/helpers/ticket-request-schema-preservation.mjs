import assert from 'node:assert/strict';

// Invert ONLY schema memoization before the existing independent Users hashes.
export function restoreTicketRequestSchema(path, source) {
  if(path!=='functions/_lib/organizations.js')return source;
  const edits=[
    ['import { readRequestSchema } from "./request-schema.js";\n',''],
    ['export async function tableExists(env, tableName) {\n  return readRequestSchema(env, `table:${tableName}`, async () => {','export async function tableExists(env, tableName) {'],
    ['  return Boolean(row?.name);\n  });','  return Boolean(row?.name);'],
    ['export async function getTableColumns(env, tableName) {\n  const names = await readRequestSchema(env, `columns:${tableName}`, async () => {','export async function getTableColumns(env, tableName) {'],
    ['  return (result?.results || []).map((row) => String(row.name));\n  });\n  // Preserve the caller-owned Set contract; callers cannot change the cache.\n  return new Set(names);','  return new Set((result?.results || []).map((row) => String(row.name)));'],
  ];
  for(const [after,before]of edits){assert.equal(source.split(after).length-1,1,'exact request-schema edit');source=source.replace(after,before);}
  return source;
}
