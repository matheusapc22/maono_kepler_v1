// Local rehearsal only. Never a generic SQL endpoint or production executor.
// The harness supplies the fixed payload at Worker construction, not in a request.
export function createLocalWorkerSource({statements, nonce}) {
  if (!Array.isArray(statements) || statements.length < 2 ||
      statements.some(s => typeof s !== 'string' || new TextEncoder().encode(s).length > 100000) ||
      typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce)) throw Error('INVALID_LOCAL_WORKER_BUILD');
  return `
const statements = ${JSON.stringify(statements)};
const nonce = ${JSON.stringify(nonce)};
let invoked = false;
export default {async fetch(request, env) {
  const url = new URL(request.url);
  if (url.origin !== 'http://localhost' || url.pathname !== '/fixed-batch' || url.search ||
      request.method !== 'POST' || request.headers.get('authorization') !== 'Bearer ' + nonce)
    return new Response('DENIED', {status:403});
  if (request.body !== null) {
    const reader=request.body.getReader();
    const first=await reader.read();
    if (!first.done) {await reader.cancel(); return new Response('BODY_NOT_ALLOWED', {status:400});}
  }
  if (invoked) return new Response('NO_REPLAY', {status:409});
  invoked = true;
  try {
    const results = await env.DB.batch(statements.map(sql => env.DB.prepare(sql)));
    if (results.length !== statements.length || results.some(r => !r.success)) throw Error('INCOMPLETE');
    return Response.json({outcome:'batch-returned', statements:results.length, remoteServiceProven:false});
  } catch {
    // Never expose SQL, defaults, credential values or engine errors.
    return Response.json({outcome:'reconcile-required', retryAllowed:false}, {status:409});
  }
}};`;
}
