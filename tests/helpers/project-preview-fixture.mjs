import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fixture as saveFixture,stored,process,localStorage } from './project-save-operation-fixture.mjs';
import * as operations from '../../functions/_lib/project-preview-operations.js';
import * as payload from '../../functions/_lib/project-preview-payload.js';
import * as pngTools from '../../functions/_lib/project-preview-png.js';
import * as http from '../../functions/_lib/http.js';
import * as preview from '../../functions/_lib/project-preview.js';
import * as dropbox from '../../functions/_lib/dropbox.js';
export function chunk(name,data) {
  const type=Buffer.from(name), output=Buffer.alloc(data.length+12);output.writeUInt32BE(data.length,0);type.copy(output,4);Buffer.from(data).copy(output,8);
  output.writeUInt32BE(pngTools.pngCrc(output.subarray(4,-4)),output.length-4);return output;
}
export function png({width=960,height=540,shade=91,filter=0,raw=null}={}) {
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const data=raw || Buffer.alloc((width*4+1)*height,shade);
  if (!raw) for(let y=0;y<height;y++) data[y*(width*4+1)]=filter;
  return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(data)),chunk('IEND',Buffer.alloc(0))]));
}
export async function fixture(t,{publishSave=true}={}) {
  const f=saveFixture(t);
  if (!f.row("SELECT name FROM sqlite_master WHERE name='project_preview_operations'")) f.sqlite.exec(readFileSync(new URL('../../migrations/0040_project_preview_operations.sql',import.meta.url),'utf8'));
  if (publishSave) f.save=await process(f,await stored(f));
  localStorage(f);f.env.PROJECT_PREVIEW_OPERATIONS_V1='true';f.env.PROJECT_PREVIEW_PROCESSOR_ENABLED='true';
  f.bytes=png();
  f.manifest={operationId:'preview-operation-0001',saveOperationId:'operation-save-0001',organizationId:'1',projectId:'1',revision:1,
    configChecksum:'a'.repeat(64),editorSessionId:'editor-session-0001',editGeneration:1,rendererVersion:'maono-png-v2',
    imageChecksum:await pngTools.previewSha256(f.bytes),sizeBytes:f.bytes.length,captureMethod:'canvas'};
  f.get=operationId=>operations.getPreviewOperation(f.env,{organizationId:1,projectId:1,actorUserId:1,operationId:operationId || f.manifest.operationId});
  f.register=(extras={})=>operations.registerPreviewOperation(f.env,{actor:f.actor,project:f.project(),manifest:{...f.manifest,...extras}});
  f.upload=async (op,bytes=f.bytes)=> {
    const claimed=await operations.acquirePreviewUpload(f.env,{operation:op});
    const artifact=await payload.uploadPreviewPayload(f.env,{operation:claimed,project:f.project(),body:bytes});
    return operations.markPreviewPayloadStored(f.env,{operation:claimed,artifact});
  };
  f.process=op=>operations.processPreviewOperation(f.env,{operation:op});
  f.ready=async()=>f.process(await f.upload(await f.register()));
  return f;
}
export function endpoint(source,dependencies) {
  return Function(...Object.keys(dependencies),source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'').replace(/^export /gm,'')+'\nreturn onRequest;')(...Object.values(dependencies));
}
export function requestHandler(f,overrides={},file='index') {
  const source=readFileSync(new URL(`../../functions/api/projects/[slug]/thumbnail/${file}.js`,import.meta.url),'utf8');
  return endpoint(source,{...operations,...payload,...pngTools,...http,...preview,...dropbox,requireSession:async()=>({id:1,role:'owner'}),
    getAuthorizedProject:async()=>f.project(),requireProjectPermission:async()=>{},...overrides});
}
export async function request(f,method='GET',query='',body=null,overrides={},headers={}) {
  const handler=requestHandler(f,overrides);
  return handler({env:f.env,params:{slug:'map'},request:new Request('https://preview.invalid/api/projects/map/thumbnail'+query,{method,
    headers:{...(body instanceof Uint8Array ? {'Content-Type':'image/png'} : body ? {'Content-Type':'application/json'} : {}),...headers},
    ...(body ? {body:body instanceof Uint8Array ? body : JSON.stringify(body)} : {})})});
}
