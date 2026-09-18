import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBaseline,
  classifySurface,
  compareWithBaseline,
  compareWithBaselineExact,
  scanText,
  summarize,
} from "./audit-user-error-sinks.mjs";

test("detecta propagação direta de error.message", () => {
  const findings = scanText(
    `catch (error) { setError(error instanceof Error ? error.message : "Falha"); }`,
    "src/example.tsx",
  );
  assert.ok(findings.some((item) => item.rule === "raw-error-message"));
});

test("detecta response.text usado no frontend", () => {
  const findings = scanText(
    `const raw = await response.text();\nsetError(raw);`,
    "src/lib/api.ts",
  );
  assert.ok(findings.some((item) => item.rule === "raw-response-text"));
});

test("detecta identificadores operacionais e vocabulário de implementação", () => {
  const findings = scanText(
    `setError(\`Worker falhou no storage; requestId=\${requestId}\`);`,
    "src/example.tsx",
  );
  assert.ok(findings.some((item) => item.rule === "diagnostic-id"));
  assert.ok(findings.some((item) => item.rule === "implementation-copy"));
});

test("kernel técnico pode preservar identificadores sem ser classificado como UI leak", () => {
  const findings = scanText(
    `const correlationId = contract.correlationId;`,
    "src/lib/error-contract.ts",
  );
  assert.equal(
    findings.some((item) => item.rule === "diagnostic-id"),
    false,
  );
});

test("não classifica copy de produto sem diagnóstico técnico", () => {
  const findings = scanText(
    `setError("Não foi possível concluir esta ação. Tente novamente.");`,
    "src/example.tsx",
  );
  assert.equal(findings.length, 0);
});

test("baseline automático inclui apenas regras high-signal", () => {
  const summary = summarize([
    { rule: "raw-error-message", file: "src/a.tsx", line: 1, snippet: "error.message" },
    { rule: "implementation-copy", file: "src/a.tsx", line: 2, snippet: "dataset" },
  ]);
  const baseline = buildBaseline(summary);
  assert.equal(baseline.byFile["src/a.tsx::raw-error-message"], 1);
  assert.equal(baseline.byFile["src/a.tsx::implementation-copy"], undefined);
});

test("classifica superfícies Admin/Ops e Change Requests separadamente", () => {
  assert.equal(classifySurface("src/pages/AdminFiles.tsx"), "admin-ops");
  assert.equal(
    classifySurface("src/pages/Kepler/change-requests/review-api.ts"),
    "paused-change-requests",
  );
  assert.equal(classifySurface("src/pages/Login/index.tsx"), "product-ui");
  assert.equal(
    classifySurface("src/pages/Kepler/map-panel/buffer-api.ts"),
    "internal-diagnostic",
  );
  assert.equal(
    classifySurface("src/pages/Kepler/cloud-providers/carto/carto-provider.ts"),
    "internal-diagnostic",
  );
});

test("ratchet legado permite redução de dívida", () => {
  const summary = { byFile: { "src/a.tsx::raw-error-message": 1 } };
  const baseline = {
    version: 2,
    rules: ["raw-error-message"],
    byFile: { "src/a.tsx::raw-error-message": 2 },
  };
  assert.deepEqual(compareWithBaseline(summary, baseline), []);
});

test("ratchet estrito falha também quando o baseline mantém folga obsoleta", () => {
  const summary = { byFile: { "src/a.tsx::raw-error-message": 1 } };
  const baseline = {
    version: 3,
    rules: ["raw-error-message"],
    byFile: { "src/a.tsx::raw-error-message": 2 },
  };
  const drift = compareWithBaselineExact(summary, baseline);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].direction, "stale-baseline");
});

test("ratchet estrito aceita baseline idêntico ao inventário", () => {
  const summary = { byFile: { "src/a.tsx::raw-error-message": 1 } };
  const baseline = {
    version: 3,
    rules: ["raw-error-message"],
    byFile: { "src/a.tsx::raw-error-message": 1 },
  };
  assert.deepEqual(compareWithBaselineExact(summary, baseline), []);
});

test("ratchet falha quando um sink high-signal aumenta ou surge em arquivo novo", () => {
  const summary = summarize([
    { rule: "raw-error-message", file: "src/a.tsx", line: 1, snippet: "error.message" },
    { rule: "raw-error-message", file: "src/a.tsx", line: 2, snippet: "error.message" },
    { rule: "raw-response-text", file: "src/new.ts", line: 3, snippet: "response.text()" },
  ]);
  const baseline = {
    version: 2,
    rules: ["raw-error-message", "raw-response-text", "diagnostic-id"],
    byFile: { "src/a.tsx::raw-error-message": 1 },
  };
  const regressions = compareWithBaseline(summary, baseline);
  assert.equal(regressions.length, 2);
});

test("vocabulário de implementação permanece review-only e não quebra ratchet", () => {
  const summary = summarize([
    { rule: "implementation-copy", file: "src/new.tsx", line: 1, snippet: "dataset" },
  ]);
  const baseline = {
    version: 2,
    rules: ["raw-error-message", "raw-response-text", "diagnostic-id"],
    byFile: {},
  };
  assert.deepEqual(compareWithBaseline(summary, baseline), []);
});
