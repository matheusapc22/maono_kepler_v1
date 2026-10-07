import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizePreviewMetrics} from '../functions/_lib/project-preview-metrics.js';
test('metrics collector strips pixels, location, project identity and unrecognized details',()=>{
 const value=sanitizePreviewMetrics({version:1,secret:'private',metrics:[{stage:'capture',durationMs:45.12,result:'ok',bytes:1024,attempt:1,pixels:'private',slug:'private',longitude:1,token:'secret'}]});
 assert.deepEqual(value,{version:1,metrics:[{stage:'capture',durationMs:45.1,result:'ok',bytes:1024,attempt:1}]});
});
test('metrics reject unlimited batches, unknown stages and unbounded numbers',()=>{
 assert.equal(sanitizePreviewMetrics({version:1,metrics:Array(33).fill({stage:'capture',durationMs:1,result:'ok'})}),null);
 for(const metric of [{stage:'camera',durationMs:1,result:'ok'},{stage:'capture',durationMs:Infinity,result:'ok'},{stage:'capture',durationMs:-1,result:'ok'}])assert.equal(sanitizePreviewMetrics({version:1,metrics:[metric]}),null);
});
test('server metrics retain only bounded numeric stage facts, never operation or provider data',async()=>{
 const {logPreviewServerMetric}=await import('../functions/_lib/project-preview-metrics.js');const original=console.info,entries=[];console.info=value=>entries.push(JSON.parse(value));
 try{logPreviewServerMetric('publication',{durationMs:12,bytes:1024,attempts:2,secret:'private',path:'/private',operationId:'private'});logPreviewServerMetric('invalid',{durationMs:1});}
 finally{console.info=original}
 assert.deepEqual(entries,[{event:'project_preview_server_metric',stage:'publication',durationMs:12,bytes:1024,attempts:2,result:'ok'}]);
});
