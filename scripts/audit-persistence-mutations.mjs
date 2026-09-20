import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Same isolated, bounded approach as audit-revision-mutations.mjs.
// No working-copy mutation, dependency installation or provider access.
const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "maono-persistence-mutations-"));
const integration = "tests/project-persistence-integration.test.mjs";
const recovery = "tests/project-recycle-recovery.test.mjs";
const repair = "scripts/project-revisions/recover-verified-absent.sql";
const large = "functions/_lib/project-large-creation.js";
const small = "functions/_lib/project-creation-lifecycle-service.js";
const stream = "functions/_lib/project-large-config-save.js";
const legacy = "functions/_lib/project-large-legacy-config-save.js";
const cases = [
  ["recovery-token", repair, "AND transition_id = ?7", "AND length(?7) > 0", recovery, "recovery CAS"],
  ["recovery-generation", repair, "attempts = attempts + 1", "attempts = attempts", recovery, "verified absent"],
  ["active-creation-fence", large, "projects.lifecycle_state = 'ACTIVE'", "projects.lifecycle_state = 'DISABLED'", integration, "large late failure callback"],
  ["newer-creation-fence", large, "projects.lifecycle_version <> ?", "projects.lifecycle_version = -1 AND ? IS NOT NULL", integration, "large failure cleanup"],
  ["small-creation-fence", small, "projects.lifecycle_version <> ?", "projects.lifecycle_version = -1 AND ? IS NOT NULL", integration, "small failure cleanup"],
  ["quota-lifecycle-cas", "functions/_lib/organization-limit-service.js", "projects.lifecycle_version = ?", "? IS NOT NULL", integration, "quota release cannot overtake"],
  ["stream-integrity", stream, 'String(metadata.providerHash || "").toLowerCase() !== contentHash.toLowerCase()', "false", integration, "versioned provider hash mismatch"],
  ["legacy-publication-ledger", legacy, /AND EXISTS \(\s*SELECT 1 FROM project_config_revisions\s*WHERE id = \? AND checksum = \? AND attempts = \? AND status = 'READY'\s*\)/, "AND (? IS NOT NULL AND ? IS NOT NULL AND ? IS NOT NULL)", integration, "legacy streaming publication rejects READY"],
];
const results = [];
try {
  for (const path of ["functions", "tests", "scripts/project-revisions", "schema.sql", "package.json", "src/pages/Kepler/save-observability.ts", "src/pages/Kepler/project-create-transport.ts"]) {
    await mkdir(dirname(join(temp, path)), { recursive: true });
    await cp(join(root, path), join(temp, path), { recursive: true });
  }
  for (const [name, file, from, to, testFile, pattern] of cases) {
    const original = await readFile(join(temp, file), "utf8");
    const changed = original.replace(from, to);
    if (changed === original) throw new Error(`Mutation target missing: ${name}`);
    const args = ["--experimental-strip-types", "--test", `--test-name-pattern=${pattern}`, testFile];
    const options = { cwd: temp, encoding: "utf8", timeout: 20000, maxBuffer: 4 * 1024 * 1024 };
    const baseline = spawnSync(process.execPath, args, options);
    if (baseline.status !== 0 || !/tests [1-9]/.test(baseline.stdout)) {
      throw new Error(`Baseline failed for ${name}: ${baseline.stdout}\n${baseline.stderr}`);
    }
    await writeFile(join(temp, file), changed);
    const run = spawnSync(process.execPath, args, options);
    const output = `${run.stdout || ""}\n${run.stderr || ""}`;
    const killed = run.status === 1 && /AssertionError|Missing expected rejection|ERR_ASSERTION/.test(output);
    results.push({ name, killed, baselineExitCode: baseline.status, exitCode: run.status, timedOut: run.error?.code === "ETIMEDOUT" });
    await writeFile(join(temp, file), original);
  }
  console.log(JSON.stringify({ results, killed: results.filter(r => r.killed).length, total: results.length }, null, 2));
  if (results.some(r => !r.killed)) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
