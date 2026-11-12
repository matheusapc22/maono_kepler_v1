import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {fixtureSql,verifyFixtureProvenance,openHistoricalFixture,fixtureSnapshot,assertHistoricalSafetyProjection} from './deletion-historical-fixture.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
// Exact non-business source seeds only; no production rows or historical literal claims.
export const bootstrapSeeds=[
 ['schema.sql','INSERT INTO cc08_schema VALUES(1);'],
 ['schema.sql','INSERT INTO ticket_sla_schema VALUES(1);'],
 ['schema.sql','INSERT INTO ticket_export_generation(id,version) VALUES(1,0);'],
 ['schema.sql','INSERT INTO project_save_operation_schema(version) VALUES (1);'],
 ['schema.sql','INSERT INTO project_save_authorization_generation(id) VALUES (1);'],
 ['schema.sql','INSERT INTO project_preview_operation_schema VALUES(1);'],
 ['migrations/0019_save_deploy_contract.sql',`INSERT INTO app_schema_metadata (id, schema_version, updated_at)
VALUES (1, 19, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET
  schema_version = excluded.schema_version,
  updated_at = CURRENT_TIMESTAMP;`],
];
export const additionalHistoricalGuards=read('tests/fixtures/deletion-historical-safety/additional-guards.test.sql');
export function historicalExecutionSchema(){
 verifyFixtureProvenance();
 const db=openHistoricalFixture();try{const projection=assertHistoricalSafetyProjection(fixtureSnapshot(db));assert.equal(projection.productionCompatible,false);}finally{db.close();}
 for(const [source,sql] of bootstrapSeeds)assert.ok(read(source).includes(sql),'Bootstrap source drift');
 return [fixtureSql,...bootstrapSeeds.map(x=>x[1]),read('migrations/0044_organization_permanent_deletion.sql'),additionalHistoricalGuards].join('\n');
}
export function requireEpochSingletons(db){
 for(const table of ['project_save_authorization_generation','ticket_export_generation']){
  const rows=db.prepare('SELECT id,version FROM '+table).all();assert.equal(rows.length,1);assert.equal(rows[0].id,1);assert.ok(Number.isSafeInteger(rows[0].version));
 }
}
