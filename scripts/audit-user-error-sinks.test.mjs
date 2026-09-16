import assert from "node:assert/strict";
import test from "node:test";

import {
  compareWithBaseline,
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

test("não classifica copy de produto sem diagnóstico técnico", () => {
  const findings = scanText(
    `setError("Não foi possível concluir esta ação. Tente novamente.");`,
    "src/example.tsx",
  );
  assert.equal(findings.length, 0);
});

test("ratchet permite redução de dívida", () => {
  const summary = { byFile: { "src/a.tsx::raw-error-message": 1 } };
  const baseline = { byFile: { "src/a.tsx::raw-error-message": 2 } };
  assert.deepEqual(compareWithBaseline(summary, baseline), []);
});

test("ratchet falha quando um sink aumenta ou surge em arquivo novo", () => {
  const summary = summarize([
    { rule: "raw-error-message", file: "src/a.tsx", line: 1, snippet: "error.message" },
    { rule: "raw-error-message", file: "src/a.tsx", line: 2, snippet: "error.message" },
    { rule: "raw-response-text", file: "src/new.ts", line: 3, snippet: "response.text()" },
  ]);
  const baseline = { byFile: { "src/a.tsx::raw-error-message": 1 } };
  const regressions = compareWithBaseline(summary, baseline);
  assert.equal(regressions.length, 2);
});
