// LOCAL CRYPTOGRAPHIC EXPERIMENT ONLY. No credential loading, signing or executor.
import {PRODUCTION_UUID} from './remote-protocol-model.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const fields=['databaseUuid','payloadSha256','auditSha256','attemptId','deploymentId','registryNamespaceId','audience'];
const claimFields=[...fields,'issuedAtMs','expiresAtMs'];
const domain='maono-synthetic-invocation-v1\nPOST\n';
const encoder=new TextEncoder();
function deny(){throw Error('SYNTHETIC_AUTH_DENIED');}
function exactFields(value,keys){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    Object.keys(value).length===keys.length && keys.every(k=>Object.hasOwn(value,k));
}
function validPins(p){
  return exactFields(p,fields) && fields.every(k=>typeof p[k]==='string') &&
    uuid.test(p.databaseUuid) && p.databaseUuid!==PRODUCTION_UUID &&
    digest.test(p.payloadSha256) && digest.test(p.auditSha256) &&
    uuid.test(p.attemptId) && uuid.test(p.deploymentId) &&
    /^[a-f0-9]{32}$/.test(p.registryNamespaceId) &&
    /^https:\/\/maono-synthetic-rehearsal-[a-z0-9-]+\.invalid\/fixed-batch$/.test(p.audience);
}
function decodeBase64Url(text){
  if(typeof text!=='string' || !/^[A-Za-z0-9_-]+$/.test(text))deny();
  const binary=atob(text.replace(/-/g,'+').replace(/_/g,'/'));
  // Reject alternate encodings, padding and non-zero unused bits.
  if(btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==text)deny();
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
export function createLocalInvocationVerifier(pinned,key){
  if(!validPins(pinned) || !(key instanceof CryptoKey) || key.type!=='secret' ||
      key.extractable || key.algorithm.name!=='HMAC' || key.algorithm.hash?.name!=='SHA-256' ||
      key.algorithm.length<256 || !key.usages.includes('verify'))deny();
  // Capture approved strings once; later caller mutations cannot change the pins.
  const fixed=Object.freeze(Object.fromEntries(fields.map(k=>[k,pinned[k]])));
  return async function verifyLocalInvocation(request,nowMs){
    try {
      if(!(request instanceof Request) || request.url!==fixed.audience || request.method!=='POST' ||
          request.body!==null || !Number.isSafeInteger(nowMs) || nowMs<0)deny();
      const header=request.headers.get('authorization');
      if(typeof header!=='string' || header.length>4096 || !header.startsWith('Maono-HMAC '))deny();
      const parts=header.slice(11).split('.');
      if(parts.length!==2)deny();
      const [encoded,signatureText]=parts;
      const bytes=decodeBase64Url(encoded),signature=decodeBase64Url(signatureText);
      if(signature.length!==32)deny();
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),claims=JSON.parse(text);
      if(!exactFields(claims,claimFields) || fields.some(k=>typeof claims[k]!=='string'||claims[k]!==fixed[k]) ||
          !Number.isSafeInteger(claims.issuedAtMs) || !Number.isSafeInteger(claims.expiresAtMs) ||
          claims.issuedAtMs<0 || claims.issuedAtMs>nowMs || claims.expiresAtMs<=nowMs ||
          claims.expiresAtMs<=claims.issuedAtMs || claims.expiresAtMs-claims.issuedAtMs>60000)deny();
      // Canonical serialization also rejects duplicate keys and unexpected fields.
      if(text!==JSON.stringify(Object.fromEntries(claimFields.map(k=>[k,claims[k]]))))deny();
      if(!await crypto.subtle.verify('HMAC',key,signature,encoder.encode(domain+encoded)))deny();
      return Object.freeze({localSignatureVerified:true,authenticatedIssuedAtMs:claims.issuedAtMs,authenticatedExpiresAtMs:claims.expiresAtMs,remoteIdentityAuthenticated:false,
        operationalAuthorization:false,replayProtectionProvided:false});
    }catch{deny();}
  };
}
