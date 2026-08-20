import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const suites = [
  { path: "tests/macro-c-c0-artifacts.test.mjs", required: true },
  { path: "tests/maono-map-schema-v1.test.mjs", required: false },
  { path: "tests/map-migration-registry.test.mjs", required: false },
  { path: "tests/map-domain-kernel.test.mjs", required: false },
  { path: "tests/dataset-version-model.test.mjs", required: false },
  { path: "tests/dataset-representation-model.test.mjs", required: false },
  { path: "tests/map-application-services.test.mjs", required: false },
  { path: "tests/map-engine-port-contract.test.mjs", required: false }
];

const missingRequired = suites.filter((suite) => suite.required && !existsSync(suite.path));
if (missingRequired.length) {
  console.error("[MACRO C GATE] Suíte obrigatória ausente:", missingRequired.map((suite) => suite.path).join(", "));
  process.exit(1);
}

const existing = suites.filter((suite) => existsSync(suite.path));
const skipped = suites.filter((suite) => !suite.required && !existsSync(suite.path));

console.log(`[MACRO C GATE] Executando ${existing.length} suíte(s).`);
for (const suite of skipped) {
  console.log(`[MACRO C GATE] SKIP futuro: ${suite.path}`);
}

// O GATE A é deliberadamente externo. Este agregador não chama
// `npm run test:foundation-gate`, evitando duplicação e acoplamento de gates.
const result = spawnSync(process.execPath, ["--test", ...existing.map((suite) => suite.path)], {
  stdio: "inherit",
  env: process.env
});

if (result.error) {
  console.error("[MACRO C GATE] Falha ao iniciar Node test runner:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
