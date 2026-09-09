import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const MIB = 1024 * 1024;
export const LARGE_CREATE_MIN_ACCEPTANCE_BYTES = 90 * MIB;
export const LARGE_CREATE_MAX_ACCEPTANCE_BYTES = 100 * MIB;
export const LARGE_CREATE_DEFAULT_TARGET_MIB = 94;

function parseTargetMiB(value) {
  const target = Number(value ?? LARGE_CREATE_DEFAULT_TARGET_MIB);
  if (!Number.isFinite(target) || target < 1 || target > 256) {
    throw new TypeError("targetMiB deve estar entre 1 e 256.");
  }
  return target;
}

export function buildLargeCreateFixture({
  targetMiB = LARGE_CREATE_DEFAULT_TARGET_MIB,
} = {}) {
  const resolvedTargetMiB = parseTargetMiB(targetMiB);
  const targetBytes = Math.round(resolvedTargetMiB * MIB);
  const config = {
    version: "v1",
    config: {
      visState: { layers: [], filters: [] },
      mapState: {},
      mapStyle: {},
    },
    datasets: [],
    acceptanceFixture: {
      kind: "maono-large-create",
      targetMiB: resolvedTargetMiB,
      payload: "",
    },
  };

  const emptyBody = JSON.stringify(config);
  const overheadBytes = Buffer.byteLength(emptyBody, "utf8");
  const fillerBytes = targetBytes - overheadBytes;
  if (fillerBytes <= 0) {
    throw new Error("O target informado é pequeno demais para a fixture.");
  }

  config.acceptanceFixture.payload = "x".repeat(fillerBytes);
  const body = JSON.stringify(config);
  const sizeBytes = Buffer.byteLength(body, "utf8");
  assert.equal(
    sizeBytes,
    targetBytes,
    `Fixture determinística deveria ter ${targetBytes} bytes e gerou ${sizeBytes}.`,
  );

  return {
    config,
    body,
    sizeBytes,
    targetBytes,
    targetMiB: resolvedTargetMiB,
    datasetCount: config.datasets.length,
    schemaName: "legacy-kepler",
    schemaVersion: 1,
    configVersion: config.version,
  };
}

export function fixtureSha256(body) {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  const targetIndex = args.indexOf("--target-mib");
  const targetMiB = targetIndex >= 0 ? args[targetIndex + 1] : undefined;
  const output = outputIndex >= 0 ? args[outputIndex + 1] : null;
  const fixture = buildLargeCreateFixture({ targetMiB });
  const sha256 = fixtureSha256(fixture.body);

  if (output) {
    await writeFile(output, fixture.body, "utf8");
  }

  const summary = {
    targetMiB: fixture.targetMiB,
    sizeBytes: fixture.sizeBytes,
    sha256,
    datasetCount: fixture.datasetCount,
    schemaName: fixture.schemaName,
    schemaVersion: fixture.schemaVersion,
    configVersion: fixture.configVersion,
    output: output || null,
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
