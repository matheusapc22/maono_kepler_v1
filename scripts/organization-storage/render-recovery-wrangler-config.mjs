import {
  mkdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WORKER_NAME = "maono-organization-storage-recovery";
const MAIN = "workers/organization-storage-recovery.js";
const COMPATIBILITY_DATE = "2026-05-21";
const DEFAULT_CRON = "*/15 * * * *";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const RECOVERY_PRODUCTION_DATABASE_ID =
  "5bc4dc32-f3bd-4c92-bbd1-cbda63e467db";
export const RECOVERY_PRODUCTION_ACCOUNT_ID =
  "09d455fa1cf988b0d9db89987b73eaff";

function booleanToml(value) {
  return value ? "true" : "false";
}

function assertDatabaseId(value) {
  const databaseId = String(value || "").trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      databaseId,
    )
  ) {
    throw new Error(
      "MAONO_RECOVERY_D1_DATABASE_ID inválido ou ausente.",
    );
  }
  if (databaseId !== RECOVERY_PRODUCTION_DATABASE_ID) {
    throw new Error("MAONO_RECOVERY_D1_DATABASE_ID deve identificar o Production maono_maps.");
  }
  return databaseId;
}

function boundedInteger(value, name, min, max) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) ||
      Number(value) < min || Number(value) > max) {
    throw new Error(`${name} deve ser um inteiro entre ${min} e ${max}.`);
  }
  return Number(value);
}

function assertCron(value) {
  const fields = typeof value === "string" ? value.trim().split(/\s+/) : [];
  const limits = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  if (fields.length !== 5) throw new Error("MAONO_RECOVERY_CRON deve conter cinco campos numéricos válidos.");
  fields.forEach((field, index) => {
    const [min, max] = limits[index];
    for (const item of field.split(",")) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item);
      if (!match) throw new Error("MAONO_RECOVERY_CRON inválido.");
      const [, range, step] = match;
      if (step !== undefined) boundedInteger(step, "Passo do cron", 1, max - min + 1);
      if (range !== "*") {
        const [start, end = start] = range.split("-").map(Number);
        boundedInteger(start, "Campo do cron", min, max);
        boundedInteger(end, "Campo do cron", min, max);
        if (start > end) throw new Error("MAONO_RECOVERY_CRON contém intervalo invertido.");
      }
    }
  });
  return fields.join(" ");
}

function relativeConfigPath(target, repositoryPath) {
  return path.relative(path.dirname(target), path.join(REPOSITORY_ROOT, repositoryPath))
    .split(path.sep).join("/");
}

function normalizeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (!["disabled", "dry-run", "apply"].includes(mode)) {
    throw new Error(
      "MAONO_RECOVERY_OPERATOR_MODE deve ser disabled, dry-run ou apply.",
    );
  }
  return mode;
}

export function renderRecoveryWranglerConfig({
  mode,
  databaseId,
  cron = DEFAULT_CRON,
  batchSize = 10,
  errorBackoffSeconds = 900,
  claimTtlSeconds = 120,
  outputPath = ".tmp/wrangler.organization-storage-recovery.toml",
} = {}) {
  const safeMode = normalizeMode(mode);
  const safeDatabaseId = assertDatabaseId(databaseId);
  const enabled = safeMode !== "disabled";
  const dryRun = safeMode !== "apply";
  const target = path.resolve(outputPath);
  const safeCron = assertCron(cron);
  const safeBatchSize = boundedInteger(batchSize, "MAONO_STORAGE_RECOVERY_BATCH_SIZE", 1, 50);
  const safeBackoff = boundedInteger(errorBackoffSeconds, "MAONO_STORAGE_RECOVERY_ERROR_BACKOFF_SECONDS", 60, 86400);
  const safeClaimTtl = boundedInteger(claimTtlSeconds, "MAONO_STORAGE_RECOVERY_CLAIM_TTL_SECONDS", 30, 1800);

  return `name = "${WORKER_NAME}"
account_id = "${RECOVERY_PRODUCTION_ACCOUNT_ID}"
main = ${JSON.stringify(relativeConfigPath(target, MAIN))}
compatibility_date = "${COMPATIBILITY_DATE}"

[vars]
MAONO_STORAGE_RECOVERY_ENABLED = "${booleanToml(enabled)}"
MAONO_STORAGE_RECOVERY_KILL_SWITCH = "${booleanToml(!enabled)}"
MAONO_STORAGE_RECOVERY_DRY_RUN = "${booleanToml(dryRun)}"
MAONO_STORAGE_RECOVERY_BATCH_SIZE = "${safeBatchSize}"
MAONO_STORAGE_RECOVERY_ERROR_BACKOFF_SECONDS = "${safeBackoff}"
MAONO_STORAGE_RECOVERY_CLAIM_TTL_SECONDS = "${safeClaimTtl}"

[[d1_databases]]
binding = "DB"
database_name = "maono_maps"
database_id = "${safeDatabaseId}"
migrations_dir = ${JSON.stringify(relativeConfigPath(target, "migrations"))}

[triggers]
crons = [${JSON.stringify(safeCron)}]
`;
}

export async function writeRecoveryWranglerConfig({
  outputPath,
  ...options
} = {}) {
  const target = path.resolve(
    outputPath || ".tmp/wrangler.organization-storage-recovery.toml",
  );
  const config = renderRecoveryWranglerConfig({ ...options, outputPath: target });
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, config, "utf8");
  return target;
}

async function main() {
  const outputPath =
    process.env.MAONO_RECOVERY_CONFIG_PATH ||
    ".tmp/wrangler.organization-storage-recovery.toml";

  const target = await writeRecoveryWranglerConfig({
    outputPath,
    mode: process.env.MAONO_RECOVERY_OPERATOR_MODE,
    databaseId: process.env.MAONO_RECOVERY_D1_DATABASE_ID,
    cron:
      process.env.MAONO_RECOVERY_CRON || DEFAULT_CRON,
    batchSize:
      process.env.MAONO_STORAGE_RECOVERY_BATCH_SIZE || 10,
    errorBackoffSeconds:
      process.env
        .MAONO_STORAGE_RECOVERY_ERROR_BACKOFF_SECONDS || 900,
    claimTtlSeconds:
      process.env.MAONO_STORAGE_RECOVERY_CLAIM_TTL_SECONDS || 120,
  });

  process.stdout.write(`${target}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error?.message || "Falha ao gerar configuração.");
    process.exitCode = 1;
  });
}
