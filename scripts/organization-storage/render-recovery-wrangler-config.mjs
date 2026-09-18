import {
  mkdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const WORKER_NAME = "maono-organization-storage-recovery";
const MAIN = "workers/organization-storage-recovery.js";
const COMPATIBILITY_DATE = "2026-05-21";
const DEFAULT_CRON = "*/15 * * * *";

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
  return databaseId;
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
} = {}) {
  const safeMode = normalizeMode(mode);
  const safeDatabaseId = assertDatabaseId(databaseId);
  const enabled = safeMode !== "disabled";
  const dryRun = safeMode !== "apply";

  return `name = "${WORKER_NAME}"
main = "${MAIN}"
compatibility_date = "${COMPATIBILITY_DATE}"

[vars]
MAONO_STORAGE_RECOVERY_ENABLED = "${booleanToml(enabled)}"
MAONO_STORAGE_RECOVERY_KILL_SWITCH = "false"
MAONO_STORAGE_RECOVERY_DRY_RUN = "${booleanToml(dryRun)}"
MAONO_STORAGE_RECOVERY_BATCH_SIZE = "${Number(batchSize)}"
MAONO_STORAGE_RECOVERY_ERROR_BACKOFF_SECONDS = "${Number(errorBackoffSeconds)}"
MAONO_STORAGE_RECOVERY_CLAIM_TTL_SECONDS = "${Number(claimTtlSeconds)}"

[[d1_databases]]
binding = "DB"
database_name = "maono_maps"
database_id = "${safeDatabaseId}"
migrations_dir = "migrations"

[triggers]
crons = ["${String(cron)}"]
`;
}

export async function writeRecoveryWranglerConfig({
  outputPath,
  ...options
} = {}) {
  const target = path.resolve(
    outputPath || ".tmp/wrangler.organization-storage-recovery.toml",
  );
  await mkdir(path.dirname(target), { recursive: true });
  const config = renderRecoveryWranglerConfig(options);
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
