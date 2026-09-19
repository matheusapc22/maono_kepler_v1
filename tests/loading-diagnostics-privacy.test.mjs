import assert from "node:assert/strict";
import test from "node:test";

import { buildLoadingStaleDiagnostic } from "../src/components/loading/loading-diagnostics.ts";

test("diagnóstico de loading não carrega rota, identidade ou payload", () => {
  const diagnostic = buildLoadingStaleDiagnostic({
    id: 3,
    label: "map-context",
    scope: "map",
    surface: "handoff",
    createdAt: 1_000,
    ageMs: 31_000,
  });

  const serialized = JSON.stringify(diagnostic);
  for (const forbidden of [
    "pathname",
    "query",
    "slug",
    "email",
    "projectId",
    "organizationId",
    "body",
    "config",
    "geometry",
    "owner",
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `campo proibido vazou: ${forbidden}`,
    );
  }
});
