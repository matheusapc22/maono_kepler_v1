import { dropboxContentHashHex } from "../../functions/_lib/dropbox-content-hash.js";

export function providerHarness() {
  const session = { id: "provider-session-1", offset: 0, bytes: [], committed: null };
  let lostNextAppend = false;
  let lostNextFinish = false;
  let appendCalls = 0;
  let finishCalls = 0;
  let forcedCommitHash = null;

  async function metadata() {
    if (!session.committed) return null;
    return session.committed;
  }

  async function fetch(url, init = {}) {
    const textUrl = String(url);
    if (textUrl.includes("oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (textUrl.includes("files/create_folder_v2")) {
      return new Response(JSON.stringify({ metadata: { id: "folder", path_display: "/folder" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (textUrl.includes("files/upload_session/start")) {
      return new Response(JSON.stringify({ session_id: session.id }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (textUrl.includes("files/upload_session/append_v2")) {
      appendCalls += 1;
      const arg = JSON.parse(init.headers["Dropbox-API-Arg"]);
      const offset = Number(arg.cursor.offset);
      if (offset !== session.offset) {
        return new Response(JSON.stringify({ error: { ".tag": "incorrect_offset", correct_offset: session.offset } }), { status: 409, headers: { "Content-Type": "application/json" } });
      }
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
      session.bytes.push(bytes);
      session.offset += bytes.byteLength;
      if (lostNextAppend) {
        lostNextAppend = false;
        return new Response("provider response lost", { status: 502 });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (textUrl.includes("files/upload_session/finish")) {
      finishCalls += 1;
      const arg = JSON.parse(init.headers["Dropbox-API-Arg"]);
      const offset = Number(arg.cursor.offset);
      if (offset !== session.offset) {
        return new Response(JSON.stringify({ error: { ".tag": "incorrect_offset", correct_offset: session.offset } }), { status: 409, headers: { "Content-Type": "application/json" } });
      }
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
      if (bytes.byteLength) {
        session.bytes.push(bytes);
        session.offset += bytes.byteLength;
      }
      const all = new Uint8Array(session.bytes.reduce((n, part) => n + part.byteLength, 0));
      let cursor = 0;
      for (const part of session.bytes) { all.set(part, cursor); cursor += part.byteLength; }
      session.committed = {
        id: "id:ticket-file",
        rev: "rev-1",
        size: all.byteLength,
        content_hash: forcedCommitHash || await dropboxContentHashHex(all),
        path_display: arg.commit.path,
      };
      if (lostNextFinish) {
        lostNextFinish = false;
        return new Response("provider response lost", { status: 502 });
      }
      return new Response(JSON.stringify(session.committed), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (textUrl.includes("files/get_metadata")) {
      const value = await metadata();
      if (!value) {
        return new Response(JSON.stringify({ error_summary: "path/not_found/.." }), { status: 409, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected provider URL: ${textUrl}`);
  }

  return {
    fetch,
    session,
    get appendCalls() { return appendCalls; },
    get finishCalls() { return finishCalls; },
    loseNextAppend() { lostNextAppend = true; },
    loseNextFinish() { lostNextFinish = true; },
    forceCommitHash(value) { forcedCommitHash = value; },
  };
}
