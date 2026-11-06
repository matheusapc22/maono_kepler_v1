import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {canonicalOrganizationName} from '../../functions/_lib/organization-identity.js';

// Input is a fresh read-only export of id,name,slug,dropbox_root_path from ALL
// organizations (including paused). This tool never connects or writes to D1.
export function auditOrganizationIdentities(rows) {
  const names=new Map(),suffixes=new Map(),paths=new Map(),conflicts=[];
  for(const row of rows){
    if(!Number.isSafeInteger(row.id)||typeof row.name!=='string'||typeof row.slug!=='string')throw new Error('Invalid organization inventory');
    const suffix=row.slug.match(/-(\d{9})$/)?.[1];
    for(const [kind,map,key] of [['name',names,canonicalOrganizationName(row.name)],['suffix',suffixes,suffix],['path',paths,row.dropbox_root_path?.toLowerCase()]]){
      if(!key)continue;
      if(map.has(key))conflicts.push({kind,ids:[map.get(key),row.id]});else map.set(key,row.id);
    }
  }
  return {ok:conflicts.length===0,organizations:rows.length,conflicts};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
  if(!Array.isArray(input))throw new Error('Expected the complete organizations array');
  const report=auditOrganizationIdentities(input);console.log(JSON.stringify(report,null,2));process.exitCode=report.ok?0:1;
}
