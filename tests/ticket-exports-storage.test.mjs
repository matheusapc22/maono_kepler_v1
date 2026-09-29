import test from "node:test";
import assert from "node:assert/strict";
import { exportStorage } from "../functions/_lib/ticket-export-storage.js";
import { dropboxContentHashHex } from "../functions/_lib/dropbox-content-hash.js";
const part = { organization_id: 1, job_id: "job", id: "part" };
const bytes = new TextEncoder().encode("text:subject\r\ntext:ação\r\n");
async function provider(
  t,
  { existing = false, conflict = false, ambiguous = false } = {},
) {
  const original = globalThis.fetch,
    calls = [];
  const metadata = {
    ".tag": "file",
    size: bytes.length,
    content_hash: await dropboxContentHashHex(bytes),
  };
  let stored = existing;
  globalThis.fetch = async (url, init) => {
    url = String(url);
    calls.push({ url, init });
    if (url.endsWith("oauth2/token"))
      return Response.json({ access_token: "fixture-only", expires_in: 3600 });
    if (url.endsWith("get_metadata"))
      return stored
        ? Response.json({ ...metadata, ...(conflict ? { size: 1 } : {}) })
        : Response.json({ error_summary: "path/not_found/" }, { status: 409 });
    if (url.endsWith("create_folder_v2"))
      return Response.json({ metadata: { ".tag": "folder" } });
    if (url.endsWith("upload_session/start"))
      return Response.json({ session_id: "test-session" });
    if (url.endsWith("upload_session/finish")) {
      assert.deepEqual(new Uint8Array(init.body), bytes);
      const arg = JSON.parse(init.headers["Dropbox-API-Arg"]);
      assert.equal(arg.cursor.offset, 0);
      assert.equal(
        arg.commit.path,
        "/maono-private-ticket-exports-v1/1/job/part.csv",
      );
      stored = true;
      if (ambiguous) throw new TypeError("lost response after remote commit");
      return Response.json(metadata);
    }
    throw new Error("Unexpected endpoint: " + url);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return {
    storage: exportStorage({
      DROPBOX_APP_KEY: "fixture",
      DROPBOX_APP_SECRET: "fixture",
      DROPBOX_REFRESH_TOKEN: "fixture",
    }),
    calls,
  };
}
test("private adapter finalizes bounded partition and retry reconciles without another upload", async (t) => {
  const { storage, calls } = await provider(t);
  await storage.put(part, bytes);
  await storage.put(part, bytes);
  assert.equal(
    calls.filter((x) => x.url.endsWith("upload_session/finish")).length,
    1,
  );
  assert.ok(calls.every((x) => !x.url.includes("shared_link")));
});
test("lost finish response is accepted only after matching size and content hash", async (t) => {
  const { storage, calls } = await provider(t, { ambiguous: true });
  await storage.put(part, bytes);
  assert.equal(
    calls.filter((x) => x.url.endsWith("upload_session/finish")).length,
    1,
  );
  assert.ok(calls.filter((x) => x.url.endsWith("get_metadata")).length >= 3);
});
test("existing object with different bytes is never overwritten", async (t) => {
  const { storage, calls } = await provider(t, {
    existing: true,
    conflict: true,
  });
  await assert.rejects(storage.put(part, bytes), {
    code: "TICKET_EXPORT_STORAGE_CONFLICT",
  });
  assert.ok(calls.every((x) => !x.url.includes("upload_session")));
});
