import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {canonicalOrganizationName} from '../../functions/_lib/organization-name.js';

// Input is a fresh read-only export of id,name,slug,dropbox_root_path from ALL
// organizations (including paused). This tool never connects or writes to D1.
export function auditOrganizationIdentities(rows) {
  if(!Array.isArray(rows))throw new Error('Invalid organization inventory');
  const names=new Map(),suffixes=new Map(),paths=new Map(),ids=new Set(),conflicts=[];
  for(const row of rows){
    // The canonical schema requires a non-null path. Missing/null columns must
    // never silently remove a uniqueness dimension from this read-only audit.
    if(!row||typeof row!=='object'||Array.isArray(row)
      ||!['id','name','slug','dropbox_root_path'].every(key=>Object.hasOwn(row,key))
      ||!Number.isSafeInteger(row.id)||row.id<=0||ids.has(row.id)
      ||!['name','slug','dropbox_root_path'].every(key=>typeof row[key]==='string'&&row[key].trim().length>0)) {
      throw new Error('Invalid organization inventory');
    }
    ids.add(row.id);
    const suffix=row.slug.match(/-(\d{9})$/)?.[1];
    for(const [kind,map,key] of [['name',names,canonicalOrganizationName(row.name)],['suffix',suffixes,suffix],['path',paths,row.dropbox_root_path.toLowerCase()]]){
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
