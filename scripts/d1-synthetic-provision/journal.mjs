// Local runner journal. Cross-run exclusion is separately enforced by GitHub history.
import {openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
function syncParents(path){if(process.platform==='win32')return;let directory=dirname(resolve(path));for(;;){const d=openSync(directory,'r');try{fsyncSync(d);}finally{closeSync(d);}const parent=dirname(directory);if(parent===directory)break;directory=parent;}}
export function createRunJournal(path) {
 let fd=null;
 const write=record=>{if(fd===null)throw Error('JOURNAL_NOT_STARTED');const line=JSON.stringify(record)+'\n';if(Buffer.byteLength(line)>32768)throw Error('JOURNAL_RECORD_TOO_LARGE');const bytes=Buffer.from(line);let offset=0;while(offset<bytes.length){const written=writeSync(fd,bytes,offset,bytes.length-offset);if(!Number.isSafeInteger(written)||written<=0)throw Error('JOURNAL_SHORT_WRITE');offset+=written;}fsyncSync(fd);return true;};
 return Object.freeze({begin(record){if(fd!==null)throw Error('JOURNAL_ALREADY_STARTED');fd=openSync(path,'wx',0o600);syncParents(path);return write(record);},record:write,close(){if(fd!==null){closeSync(fd);fd=null;}}});
}
