import assert from "node:assert/strict";
import test from "node:test";
import { ensureDropboxFolder } from "../functions/_lib/dropbox.js";

async function folderFixture(tag, run) {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: String(init?.body || "") });
    if (String(url).includes("oauth2/token")) return Response.json({ access_token: "test-token", expires_in: 3600 });
    if (String(url).includes("create_folder_v2")) return Response.json({ error_summary: "path/conflict/..." }, { status: 409 });
    if (String(url).includes("get_metadata")) return Response.json({ ".tag": tag, path_lower: JSON.parse(init.body).path });
    throw new Error("unexpected provider request");
  };
  try {
    await run({ DROPBOX_APP_KEY: "key", DROPBOX_APP_SECRET: "secret", DROPBOX_REFRESH_TOKEN: "refresh" }, calls);
  } finally { globalThis.fetch = previousFetch; }
}

test("folder conflicts verify actual metadata for each path component", async () => {
  await folderFixture("folder", async (env, calls) => {
    const result = await ensureDropboxFolder(env, "/projects/acme/documents");
    assert.equal(result.path, "/projects/acme/documents");
    assert.deepEqual(calls.filter((call) => call.url.includes("get_metadata")).map((call) => JSON.parse(call.body).path), ["/projects", "/projects/acme", "/projects/acme/documents"]);
  });
});

test("file conflict never passes as a successfully provisioned folder", async () => {
  await folderFixture("file", async (env, calls) => {
    await assert.rejects(ensureDropboxFolder(env, "/projects/acme/documents"), { code: "DROPBOX_FOLDER_TYPE_CONFLICT", retryable: false });
    assert.equal(calls.filter((call) => call.url.includes("create_folder_v2")).length, 1);
  });
});
