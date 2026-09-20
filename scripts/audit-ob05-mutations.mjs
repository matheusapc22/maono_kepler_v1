import { cp, mkdir, mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Reuse the isolated mutation approach of audit-persistence-mutations.mjs.
// No source mutation in the checkout, dependency install or remote provider.
const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "maono-ob05-mutations-"));
const cluster = "src/pages/Kepler/clustering/";
const cases = [
  ["geojson-authorization-bypass", "functions/_lib/access-governance.js",
    'const normalizedOperation = operation === "revoke" ? "revoke" : "grant";',
    'const normalizedOperation = operation === "revoke" ? "revoke" : "grant"; if (normalizedPermission === "organization.projects.geojson.view") return {allowed:true};',
    "tests/geojson-organization-access.test.mjs", "permissão ampla"],
  ["unknown-profile-promoted", "src/pages/Projects/components/user-access-commercial.ts",
    "      : null)", "      : COMMERCIAL_PROFILES[0])",
    "tests/user-access-commercial.test.mjs", "combinações existentes"],
  ["spatial-radius-drift", `${cluster}point-cluster-policy.ts`,
    "export const DEFAULT_CLUSTER_SIZE = 40;", "export const DEFAULT_CLUSTER_SIZE = 55;",
    "tests/point-clustering-policy.test.mjs", "defaults"],
  ["legacy-pair-retained", `${cluster}point-cluster-controller.ts`,
    "(layer: any) => !originalLayerIdFromLegacyCluster(layer)", "(layer: any) => true",
    "tests/point-clustering-integration.test.mjs", "migra par legado"],
  ["hysteresis-boundary-drift", `${cluster}point-cluster-policy.ts`,
    "normalizedZoom > upperBoundary", "normalizedZoom >= upperBoundary",
    "tests/point-clustering-zoom.test.mjs", "sequência de zoom"],
  ["feature-off-ignored", `${cluster}point-cluster-policy.ts`,
    'return environmentValue !== "false";', "return true;",
    "tests/point-clustering-integration.test.mjs", "feature flag desativada"],
];
const results = [];
try {
  for (const path of ["functions", "tests", "src", "schema.sql", "package.json"]) {
    await mkdir(dirname(join(temp, path)), { recursive: true });
    await cp(join(root, path), join(temp, path), { recursive: true });
  }
  await symlink(join(root, "node_modules"), join(temp, "node_modules"), "dir");
  for (const [name, file, from, to, testFile, pattern] of cases) {
    const original = await readFile(join(temp, file), "utf8");
    if (original.split(from).length !== 2) throw new Error(`Mutation target not unique: ${name}`);
    const args = ["--experimental-strip-types", "--test", `--test-name-pattern=${pattern}`, testFile];
    const options = { cwd: temp, encoding: "utf8", timeout: 20000, maxBuffer: 4 * 1024 * 1024 };
    const baseline = spawnSync(process.execPath, args, options);
    if (baseline.status !== 0 || !/tests [1-9]/.test(baseline.stdout)) {
      throw new Error(`Baseline failed for ${name}: ${baseline.stdout}\n${baseline.stderr}`);
    }
    await writeFile(join(temp, file), original.replace(from, to));
    const run = spawnSync(process.execPath, args, options);
    const output = `${run.stdout || ""}\n${run.stderr || ""}`;
    const killed = run.status === 1 && /AssertionError|Missing expected rejection|ERR_ASSERTION/.test(output);
    results.push({ name, killed, baselineExitCode: baseline.status, exitCode: run.status, timedOut: run.error?.code === "ETIMEDOUT" });
    await writeFile(join(temp, file), original);
  }
  console.log(JSON.stringify({ results, killed: results.filter(r => r.killed).length, total: results.length }, null, 2));
  if (results.some(result => !result.killed)) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
