import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../functions/api/projects/[slug]/config-stream.js", import.meta.url),
  "utf8",
);

test("config-stream defers audit writes outside the response critical path", () => {
  assert.match(source, /function scheduleAudit\(/);
  assert.match(source, /context\.waitUntil\(settled\)/);
  assert.doesNotMatch(
    source,
    /await auditStream\(env, request, user, project, slug, "success"/,
  );
});

test("config-stream bounds storage preparation before response headers", () => {
  assert.match(source, /STREAM_START_TIMEOUT_MS\s*=\s*20_000/);
  assert.match(source, /PROJECT_CONFIG_STREAM_START_TIMEOUT/);
  assert.match(source, /withStreamStartDeadline\(/);
  assert.match(source, /preparePublishedUpstream\(/);
});

test("config-stream aborts a stalled response body instead of hanging forever", () => {
  assert.match(source, /STREAM_INACTIVITY_TIMEOUT_MS\s*=\s*20_000/);
  assert.match(source, /PROJECT_CONFIG_STREAM_INACTIVITY_TIMEOUT/);
  assert.match(source, /withStreamInactivityWatchdog\(upstream\.body\)/);
});

test("config-stream never falls back to buffering the entire MapConfig", () => {
  assert.doesNotMatch(source, /upstream\.arrayBuffer\(/);
  assert.match(source, /PROJECT_CONFIG_STREAM_BODY_UNAVAILABLE/);
});
