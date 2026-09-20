import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Same isolated-copy approach as audit-ob05-mutations.mjs. The real SLO
// tests run unchanged; neither the checkout nor a remote system is mutated.
const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "maono-ob07-mutations-"));
const file = "scripts/organization-storage/reliability-slo-report.mjs";
const cases = [
  ["contradictory-initial-classification", "previous.retryable === event.retryable", "true", "classificações iniciais contraditórias"],
  ["insufficient-samples-approved", "total < rule.minSamples", "false", "amostra insuficiente"],
  ["unverified-ready-accepted", 'event.type === "operational" && event.physicallyVerified === true &&', 'event.type === "operational" &&', "READY sem verificação física"],
  ["provisioning-deadline-drift", "duration <= contract.provisioning.deadlineMs", "duration < contract.provisioning.deadlineMs", "deadline inclusivo"],
];
const results = [];
try {
  for (const path of ["functions", "scripts/organization-storage", "tests/organization-storage-slo.test.mjs", "package.json"]) {
    await mkdir(dirname(join(temp, path)), { recursive: true });
    await cp(join(root, path), join(temp, path), { recursive: true });
  }
  for (const [name, from, to, pattern] of cases) {
    const original = await readFile(join(temp, file), "utf8");
    if (original.split(from).length !== 2) throw new Error(`Mutation target not unique: ${name}`);
    const args = ["--test", `--test-name-pattern=${pattern}`, "tests/organization-storage-slo.test.mjs"];
    const options = { cwd: temp, encoding: "utf8", timeout: 20000, maxBuffer: 4 * 1024 * 1024 };
    const baseline = spawnSync(process.execPath, args, options);
    if (baseline.status !== 0 || !/tests [1-9]/.test(baseline.stdout)) throw new Error(`Baseline failed: ${name}\n${baseline.stdout}\n${baseline.stderr}`);
    await writeFile(join(temp, file), original.replace(from, to));
    const run = spawnSync(process.execPath, args, options);
    const killed = run.status === 1 && /AssertionError|ERR_ASSERTION/.test(`${run.stdout}\n${run.stderr}`);
    results.push({ name, killed, baselineExitCode: baseline.status, exitCode: run.status, timedOut: run.error?.code === "ETIMEDOUT" });
    await writeFile(join(temp, file), original);
  }
  console.log(JSON.stringify({ results, killed: results.filter((value) => value.killed).length, total: results.length }, null, 2));
  if (results.some((value) => !value.killed)) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
