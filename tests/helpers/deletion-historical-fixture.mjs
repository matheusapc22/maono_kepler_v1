import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {DELETION_SCHEMA_QUERIES,evaluateDeletionSchema} from '../../scripts/migrations/organization-deletion-schema-0044.mjs';
import {recognizeDefinition} from '../../scripts/migrations/deletion-semantic-diagnostics.mjs';
const root=new URL('../../',import.meta.url),dir=new URL('../fixtures/deletion-historical-safety/',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8').replace(/\r\n/g,'\n');
export const fixtureManifest=JSON.parse(readFileSync(new URL('manifest.json',dir),'utf8'));
export const observedStructure=JSON.parse(readFileSync(new URL('observed-structure.json',dir),'utf8'));
export const fixtureSql=readFileSync(new URL('schema.sql',dir),'utf8').replace(/\r\n/g,'\n');
export const hash=s=>createHash('sha256').update(s).digest('hex');
const plain=x=>JSON.parse(JSON.stringify(x));
export function fixtureSnapshot(db){return Object.fromEntries(Object.entries(DELETION_SCHEMA_QUERIES).map(([key,sql])=>[key,db.prepare(sql).all()]));}
export function openHistoricalFixture(sql=fixtureSql){const db=new DatabaseSync(':memory:');try{db.exec(sql);return db;}catch(error){db.close();throw error;}}
export function verifyFixtureProvenance(){
 assert.equal(hash(fixtureSql),fixtureManifest.fixtureSha256);
 const files=Object.fromEntries(Object.entries(fixtureManifest.sourcePins).map(([name,pin])=>{const text=read(pin.localPath);assert.equal(hash(text),pin.sha256,'Source drift: '+name);return [name,text];}));
 const canonical=new DatabaseSync(':memory:');canonical.exec(files['schema.sql'].split('-- Organization permanent deletion (migration 0044)')[0]);
 try{for(const object of fixtureManifest.objects){
  if(object.category==='canonical-source'){const row=canonical.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(object.name);assert.equal(row?.sql,object.sql,'Canonical source mismatch: '+object.name);}
  if(object.category==='versioned-reconstruction'){
   const db=new DatabaseSync(':memory:');try{
    if(object.type!=='table'){const target=fixtureManifest.objects.find(o=>o.name===object.table&&o.type==='table');assert.ok(target);db.exec(target.sql);}
    for(const step of object.steps){assert.equal(hash(step.statement),step.sha256);assert.ok(files[step.source].includes(step.statement),'Missing source statement');db.exec(step.statement);}
    assert.equal(db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(object.name)?.sql,object.sql,'Reconstruction mismatch: '+object.name);
   }finally{db.close();}
  }
 }}finally{canonical.close();}
 return {canonical:469,reconstructed:30,structural:31,operationalApproval:false};
}
function maskedAst(ast){
 const value=plain(ast);
 if(value.kind==='table')for(const column of value.items.filter(x=>x.kind==='column'))for(const c of column.constraints){
  const slot=value.name+'.'+column.name,spec=fixtureManifest.syntheticDefaults[slot];
  if(spec&&c.kind==='default'){
   assert.equal(c.expression.kind,'opaque-literal','Only scalar literal defaults may vary');
   assert.equal(c.expression.type,spec.literalType,'Literal class drift');
   c.expression={kind:'synthetic-default-slot',slot,type:spec.literalType};
  }
 }
 return value;
}
function maskedMetadata(input){
 const result=plain(input);
 for(const c of result.columns){const spec=fixtureManifest.syntheticDefaults[c.table+'.'+c.name];if(spec){assert.equal(c.defaultPresent,true);c.defaultDigest='explicit-synthetic-default-slot';}}
 for(const i of result.indexes)if(fixtureManifest.objects.some(o=>o.name===i.name&&o.category==='reviewed-structural-projection'))i.definitionDigest='exact-AST-checked-separately';
 // SQLite index seq reflects creation order; fixture construction deliberately preserves it.
 return result;
}
export function assertHistoricalSafetyProjection(snapshot){
 const report=evaluateDeletionSchema(snapshot); // Existing production comparison remains blocked.
 const wanted=fixtureManifest.objects.map(o=>[o.type,o.name,o.table]).sort();
 const actual=snapshot.objects.map(o=>[o.type,o.name,o.tbl_name]).sort();assert.deepEqual(plain(actual),wanted,'Object inventory drift');
 for(const object of fixtureManifest.objects){
  const row=snapshot.objects.find(o=>o.name===object.name);
  if(object.category==='reviewed-structural-projection'){
   const parsed=recognizeDefinition(row);assert.equal(parsed.status,'recognized-subset','Unsupported definition');
   assert.deepEqual(maskedAst(parsed.ast),maskedAst(object.ast),'Structural AST drift: '+object.name);
  }else assert.equal(report.objects.find(o=>o.name===object.name).definitionDigest,object.observedDefinitionDigest,'Versioned definition drift: '+object.name);
 }
 assert.deepEqual(maskedMetadata(report.structuralMetadata),maskedMetadata(observedStructure),'Metadata drift');
 return {completeObjectProjection:true,scope:'deletion-safety-test-fixture-only',generalDdlEquivalent:false,operationalApproval:false,productionCompatible:report.compatible,fullSnapshotDigest:hash(JSON.stringify({applicationSnapshot:snapshot,internalEnvelope:fixtureManifest.internalEnvelope})),observedFullSnapshotDigest:fixtureManifest.observedMetadataDigest,internalEnvelope:fixtureManifest.internalEnvelope};
}
export const historicalMissingGuardTables=Object.freeze(['organization_exports','organization_feature_flags','organization_limits','organization_roadmaps','roadmap_comments','roadmap_dependencies','roadmap_events','roadmap_phases','roadmap_tasks','tickets']);
