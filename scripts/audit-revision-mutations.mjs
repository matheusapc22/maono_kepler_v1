import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Deliberately bounded mutation check. Never touches the working copy or a provider.
const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "maono-revision-mutations-"));
const file = "functions/_lib/project-config-revisions.js";
const results = [];
try {
  for (const path of ["functions", "tests", "schema.sql", "package.json"]) {
    await cp(join(root, path), join(temp, path), { recursive: true });
  }
  const original = await readFile(join(temp, file), "utf8");
  const cases = [
    ["conflict-variable", "currentConfigRevision: currentRevision,", "currentConfigRevision,"],
    ["cleanup-fence", "SET error_stage = 'RECYCLE', transition_id = ?", "SET error_stage = NULL, transition_id = ?"],
    ["published-head-guard", /AND NOT EXISTS \(\s*SELECT 1 FROM projects\s*WHERE projects.id = project_config_revisions.project_id\s*AND projects.config_revision >= project_config_revisions.revision\s*\)/, "AND 1 = 1"],
    ["publication-ledger-cas", /AND EXISTS \(\s*SELECT 1 FROM project_config_revisions\s*WHERE id = \? AND checksum = \? AND attempts = \? AND status = 'READY'\s*\)/, "AND (? IS NOT NULL AND ? IS NOT NULL AND ? IS NOT NULL)"],
    ["failure-attempt-guard", /AND checksum = \? AND attempts = \?\s*AND error_stage IS NOT 'RECYCLE'\s*AND status <> 'READY'/, "AND ? IS NOT NULL AND ? IS NOT NULL AND error_stage IS NOT 'RECYCLE' AND status <> 'READY'"],
  ];
  for (const [name, from, to] of cases) {
    const changed = original.replace(from, to);
    if (changed === original) throw new Error(`Mutation target missing: ${name}`);
    await writeFile(join(temp, file), changed);
    const run = spawnSync(process.execPath, ["--test", "tests/project-config-revision-concurrency.test.mjs"], {
      cwd: temp, encoding: "utf8", timeout: 15000,
    });
    const output = `${run.stdout || ""}\n${run.stderr || ""}`;
    const assertionFailure = /AssertionError|Missing expected rejection|ERR_ASSERTION/.test(output);
    const killed = run.status === 1 && assertionFailure;
    results.push({ name, killed, exitCode: run.status, timedOut: run.error?.code === "ETIMEDOUT" });
  }
  console.log(JSON.stringify({ scope: file, results, killed: results.filter(r => r.killed).length, total: results.length }, null, 2));
  if (results.some(r => !r.killed)) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
