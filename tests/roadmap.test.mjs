import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { roadmapErrorResponse } from "../functions/_lib/roadmaps.js";

test("migration cria o domínio multi-tenant completo do roadmap", async () => {
  const sql = await readFile(new URL("../migrations/0011_roadmap_gantt.sql", import.meta.url), "utf8");
  for (const table of ["organization_roadmaps", "roadmap_phases", "roadmap_tasks", "roadmap_dependencies", "roadmap_comments", "roadmap_events"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(sql, /organization_id INTEGER NOT NULL/);
  assert.match(sql, /version INTEGER NOT NULL DEFAULT 1/);
  assert.match(sql, /roadmap\.task\.manage/);
  assert.match(sql, /\('admin', 'roadmap\.manage'/);
  assert.match(sql, /\('viewer', 'roadmap\.comment\.create'/);
});

test("erros do roadmap preservam código e requestId sem expor erro interno", async () => {
  const request = new Request("https://maono.test", { headers: { "X-Request-Id": "roadmap-test-1" } });
  const clientError = new Error("Data inválida");
  clientError.status = 400;
  clientError.code = "INVALID_DATE";
  const response = roadmapErrorResponse(clientError, request);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: "Data inválida", code: "INVALID_DATE", requestId: "roadmap-test-1" });

  const internal = roadmapErrorResponse(new Error("segredo"), request);
  assert.equal((await internal.json()).error, "Erro interno ao processar o roadmap.");
});
