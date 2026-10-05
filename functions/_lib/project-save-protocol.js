import { errorResponse } from "./http.js";

// The old writer is deliberately unavailable even while new admissions pause.
// Updating the page is advisory: never reload or discard the user's draft here.
export function retiredSaveProtocolResponse() {
  return errorResponse(
    "Esta página usa um salvamento antigo. Preserve ou exporte suas alterações antes de atualizar a página.",
    412,
    "SAVE_CLIENT_CONTRACT_UNSUPPORTED",
    { requiredClientContract: 2, preserveDraft: true },
    { headers: { "X-Maono-Api-Contract": "2", "Cache-Control": "no-store" } },
  );
}

export function primarySaveEnvironment(env) {
  return env.DB?.withSession
    ? { ...env, DB: env.DB.withSession("first-primary") }
    : env;
}

export function assertSameSaveOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw Object.assign(new Error("Origem inválida para salvamento."), {
      status: 403, code: "PROJECT_SAVE_ORIGIN_DENIED",
    });
  }
}

function saveBodyError(message,status,code) { return Object.assign(new Error(message),{status,code}); }
export async function readBoundedSaveJsonBody(request) {
  const max = 16 * 1024;
  if (Number(request.headers.get("content-length") || 0) > max) throw saveBodyError("Manifesto excede o limite.",413,"SAVE_MANIFEST_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw saveBodyError("Manifesto ausente.",400,"SAVE_MANIFEST_REQUIRED");
  const chunks=[];
  let size=0;
  try {
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>max) { await reader.cancel(); throw saveBodyError("Manifesto excede o limite.",413,"SAVE_MANIFEST_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size); let offset=0;
  for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try {
    const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
    if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("Invalid manifest shape");
    return value;
  }
  catch { throw saveBodyError("Manifesto JSON inválido.",400,"SAVE_MANIFEST_INVALID"); }
}
