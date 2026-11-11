import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";

test("real CLI scans and enforces strict baseline on Windows and POSIX", (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "error sink CLI "));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  mkdirSync(path.join(directory, "src"));
  writeFileSync(path.join(directory, "src", "fixture.ts"), "const value = error.message;\n");
  writeFileSync(path.join(directory, "baseline.json"), JSON.stringify({
    version: 3, rules: ["raw-error-message"], byFile: {},
  }));
  const script = fileURLToPath(new URL("./audit-user-error-sinks.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--json", "--baseline", "baseline.json", "--strict-baseline"], {
    cwd: directory, encoding: "utf8", timeout: 10000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.byFile["src/fixture.ts::raw-error-message"], 1);
  assert.match(result.stderr, /src\/fixture\.ts::raw-error-message: 0 -> 1/);
});

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

test("fluxo interno de criação pode preservar stage operacional", () => {
  const findings = scanText(
    `const stage = error.stage; onStage(stage);`,
    "src/pages/Kepler/project-create-flow.ts",
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

test('organization deletion diagnostic hits are only the reviewed idempotency key', () => {
  const file='src/pages/Admin/organizations/OrganizationDeletionPanel.tsx';
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const findings=scanText(source,file);
  const diagnostics=findings.filter(finding=>finding.rule==='diagnostic-id');
  // These are internal UUID plumbing, not server Error.message/request diagnostics
  // rendered to the operator. Any additional usage requires a fresh review.
  assert.equal(diagnostics.length,2);
  const lines=source.split(/\r?\n/);
  assert.deepEqual(diagnostics.map(finding=>lines[finding.line-1].trim()),[
    'const requestId=key.current||crypto.randomUUID();remember(null,requestId);setUncertain(true);',
    "value=(await api<{deletion:Deletion}>(`/organizations/${organizationId}/permanent-delete`,{body:{version:preview.version,confirmation},key:requestId,signal:c.signal,timeoutMs:20000})).deletion;",
  ]);
  assert.equal(findings.some(finding=>['raw-error-message','raw-response-text'].includes(finding.rule)),false);
  assert.doesNotMatch(source.slice(source.indexOf('return <section')),/\brequestId\b/);
  const baseline=JSON.parse(readFileSync(new URL('./user-error-sink-baseline.json',import.meta.url),'utf8'));
  assert.equal(baseline.byFile[file+'::diagnostic-id'],2);
});
