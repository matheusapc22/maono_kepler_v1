import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {onRequest as management} from '../../functions/api/admin/organization-management/[[path]].js';
import {onRequest as session} from '../../functions/api/session.js';

// The persistence fixture replaces global fetch for its synthetic provider.
// Keep the original transport solely for the validated loopback asset origin.
const fetchAssets=globalThis.fetch.bind(globalThis);

// Native loopback HTTP preserves the browser's actual cookie transport. On
// Windows WebKit the interception event precedes curl adding its Cookie header;
// constructing a Request from that event can incorrectly erase authentication.
// Only compiled assets are proxied, and their origin must also be loopback.
export async function organizationManagementBrowserServer(env, assetOrigin) {
  const assets=new URL(assetOrigin);
  assert.equal(assets.protocol,'http:');
  assert.ok(['127.0.0.1','localhost'].includes(assets.hostname));
  const requests=[],errors=[];
  let origin;
  const server=createServer(async(incoming,outgoing)=>{
    try{
      const url=new URL(incoming.url||'/',origin);
      let response;
      if(url.pathname.startsWith('/api/')){
        requests.push({method:incoming.method,path:url.pathname,cookiePresent:Boolean(incoming.headers.cookie)});
        const headers=new Headers();
        for(const [key,value]of Object.entries(incoming.headers)){
          if(Array.isArray(value))for(const item of value)headers.append(key,item);
          else if(value!==undefined)headers.set(key,value);
        }
        const chunks=[];
        for await(const chunk of incoming)chunks.push(Buffer.from(chunk));
        const body=Buffer.concat(chunks).toString('utf8');
        const request=new Request(url,{method:incoming.method,headers,...(body?{body}:{})});
        if(url.pathname==='/api/session'||url.pathname.startsWith('/api/admin/organization-management/')){
          response=await (url.pathname==='/api/session'?session:management)({env,request});
        }else if(incoming.method==='GET'){
          response=Response.json({ok:true,enabled:false,notifications:[],unreadCount:0});
        }else{
          throw new Error(`Unexpected browser mutation: ${incoming.method} ${url.pathname}`);
        }
      }else{
        response=await fetchAssets(new URL(url.pathname+url.search,assets),{redirect:'manual'});
      }
      outgoing.statusCode=response.status;
      response.headers.forEach((value,key)=>{
        if(!['connection','transfer-encoding','content-encoding','content-length','set-cookie'].includes(key))outgoing.setHeader(key,value);
      });
      const cookies=response.headers.getSetCookie();
      if(cookies.length)outgoing.setHeader('set-cookie',cookies);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){
      errors.push(error instanceof Error?error.message:String(error));
      outgoing.statusCode=500;
      outgoing.end('Local browser fixture failed');
    }
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  const address=server.address();
  assert.ok(address&&typeof address!=='string');
  origin=`http://127.0.0.1:${address.port}`;
  return {origin,requests,errors,async close(){
    server.closeAllConnections();
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }};
}
