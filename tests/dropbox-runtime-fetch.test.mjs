import assert from "node:assert/strict";
import test from "node:test";

import { createDropboxClient } from "../functions/_lib/dropbox-client.js";

const ENV = {
  DROPBOX_APP_KEY: "app-key",
  DROPBOX_APP_SECRET: "app-secret",
  DROPBOX_REFRESH_TOKEN: "refresh-secret",
};

test("fetch nativo mantém globalThis como receiver", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async function (...args) {
    assert.equal(this, globalThis);
    calls += 1;
    assert.match(String(args[0]), /dropboxapi\.com/);
    return new Response("{}", { status: 200 });
  };

  try {
    const client = createDropboxClient(ENV, {
      metricFn: () => {},
      sleepFn: async () => {},
    });

    const result = await client.request({
      operation: "files.test",
      url: "https://api.dropboxapi.com/2/files/test",
      auth: false,
      maxRetries: 0,
      timeoutMs: 1_000,
      buildInit: () => ({ method: "POST" }),
    });

    assert.equal(result.status, 200);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
