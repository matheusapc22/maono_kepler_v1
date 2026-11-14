// Read-only operational CLI. No Wrangler session, production config or token fallback.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import {join} from 'node:path';
import {parsePinnedManifest,manifestSha256 as computeManifestSha256} from './manifest.mjs';
import {collectReadonlyPinnedMetadata} from './readonly-provider.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
try{
 const [mode,...args]=process.argv.slice(2);
 if(!['--validate','--audit'].includes(mode)||args.length!==0)throw Error('INVALID_MODE');
 const bytes=readFileSync(join(root,'ops/d1-synthetic/manifest.json'));
 const expected=mode==='--audit'?process.env.MAONO_SYNTHETIC_MANIFEST_SHA256:computeManifestSha256(bytes);
 const {manifest,status,manifestSha256}=parsePinnedManifest(bytes,expected,{requireEnabled:mode==='--audit'});
 if(mode==='--validate'){console.log(JSON.stringify({manifestSha256,...status}));}
 else{
  if(process.env.MAONO_ENABLE_SYNTHETIC_READONLY_AUDIT!=='1'||!process.env.MAONO_SYNTHETIC_AUDIT_READ_TOKEN)throw Error('AUDIT_DISABLED');
  const result=await collectReadonlyPinnedMetadata({manifest:manifest.target,token:process.env.MAONO_SYNTHETIC_AUDIT_READ_TOKEN});
  mkdirSync(join(root,'.tmp'),{recursive:true});
  writeFileSync(join(root,'.tmp/d1-remote-audit-summary.json'),JSON.stringify({manifestSha256,...result},null,2));
  console.log('SYNTHETIC_READONLY_METADATA_AUDIT_COMPLETE; no active-routing, bundle-authenticity or migration authorization claim');
 }
}catch{console.error('SYNTHETIC_READONLY_AUDIT_FAILED_CLOSED');process.exitCode=1;}
