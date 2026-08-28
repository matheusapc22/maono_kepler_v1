import assert from "node:assert/strict";
import test from "node:test";

import {
  PREVIEW_WRITE_REASONS,
  evaluatePreviewWritePolicy,
  isPreviewTransientAnalysisPath,
} from "../functions/_lib/preview-write-policy.js";
import { onRequest } from "../functions/_middleware.js";

function previewEnv() {
  return {
    MAONO_RUNTIME_ENV: "preview",
    MAONO_PREVIEW_MUTATIONS_ENABLED: "false",
  };
}

test("isócronas e buffers são classificados como análises transitórias", () => {
  assert.equal(isPreviewTransientAnalysisPath("/api/maps/isochrones"), true);
  assert.equal(isPreviewTransientAnalysisPath("/api/maps/buffers"), true);
  assert.equal(isPreviewTransientAnalysisPath("/api/projects/demo/config"), false);
});

test("análise transitória é permitida mesmo com mutations=false", () => {
  for (const pathname of ["/api/maps/isochrones", "/api/maps/buffers"]) {
    const decision = evaluatePreviewWritePolicy(previewEnv(), {
      method: "POST",
      pathname,
    });

    assert.equal(decision.allowed, true, pathname);
    assert.equal(
      decision.reason,
      PREVIEW_WRITE_REASONS.PREVIEW_TRANSIENT_ANALYSIS_ALLOWED,
      pathname,
    );
  }
});

test("save de projeto continua bloqueado com mutations=false", () => {
  const decision = evaluatePreviewWritePolicy(previewEnv(), {
    method: "PUT",
    pathname: "/api/projects/demo/config",
    organizationId: "42",
  });

  assert.equal(decision.allowed, false);
  assert.equal(
    decision.reason,
    PREVIEW_WRITE_REASONS.PREVIEW_MUTATIONS_DISABLED,
  );
});

test("middleware deixa POST de Buffer chegar ao endpoint e publica diagnóstico", async () => {
  let nextCalls = 0;
  const response = await onRequest({
    request: new Request("https://preview.example/api/maps/buffers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectSlug: "demo",
        origin: { latitude: -21.7, longitude: -43.3 },
        unit: "m",
        ranges: [500],
      }),
    }),
    env: previewEnv(),
    async next() {
      nextCalls += 1;
      return new Response("buffer-ok", { status: 200 });
    },
  });

  assert.equal(nextCalls, 1);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("X-Maono-Preview-Write"),
    "PREVIEW_TRANSIENT_ANALYSIS_ALLOWED",
  );
});
