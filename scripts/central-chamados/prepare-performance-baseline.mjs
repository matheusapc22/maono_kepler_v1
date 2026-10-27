import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const root='.tmp/ticket-performance';
await mkdir(`${root}/baseline-source`,{recursive:true});
// Archive committed source only: no checkout .env, credentials or local data.
execFileSync('git',['archive','--format=tar',`--output=${root}/baseline-source.tar`,'381c93256d985b0ae39722128fc4ad54f17f025f','functions','package.json']);
execFileSync('tar',['-xf',`${root}/baseline-source.tar`,'-C',`${root}/baseline-source`]);
console.log('Isolated baseline functions prepared from 381c93256d985b0ae39722128fc4ad54f17f025f');
