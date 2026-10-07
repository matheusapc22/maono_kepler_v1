import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { main } from "../scripts/large-create/preview-acceptance.mjs";

const runner = await readFile(new URL("../scripts/large-create/preview-acceptance.mjs", import.meta.url), "utf8");
test("unaudited Preview runner is retired before any request or credential read", () => {
  assert.throws(main, { code: "PREVIEW_ACCEPTANCE_RETIRED" });
  assert.doesNotMatch(runner, /\bfetch\s*\(|process\.env|SESSION_COOKIE|prepareProjectCreateTransport|\/config`/);
  assert.match(runner, /bindings may share Production/);
  assert.match(runner, /durable-project-save/);
  assert.match(runner, /production-acceptance-operator\.yml/);
  assert.match(runner, /separate Worker deployment approval/);
});
test("retired CLI fails visibly rather than claiming synthetic acceptance passed", () => {
  const output = spawnSync(process.execPath, ["scripts/large-create/preview-acceptance.mjs"], { encoding: "utf8" });
  assert.equal(output.status, 1);
  assert.equal(output.stdout, "");
  assert.match(output.stderr, /PREVIEW_ACCEPTANCE_RETIRED/);
});
