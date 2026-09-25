import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WORKER_NAME = "maono-document-purge";
const MAIN = "workers/organization-file-purge.js";
const COMPATIBILITY_DATE = "2026-05-21";
const DEFAULT_CRON = "0 * * * *";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const PURGE_PRODUCTION_DATABASE_ID =
  "5bc4dc32-f3bd-4c92-bbd1-cbda63e467db";
export const PURGE_PRODUCTION_ACCOUNT_ID =
  "09d455fa1cf988b0d9db89987b73eaff";

function boundedInteger(value, name, min, max) {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    throw new Error(`${name} deve ser um inteiro entre ${min} e ${max}.`);
  }
  return Number(value);
}

function assertDatabaseId(value) {
  const databaseId = String(value || "").trim();
  if (databaseId !== PURGE_PRODUCTION_DATABASE_ID) {
    throw new Error(
      "MAONO_PURGE_D1_DATABASE_ID deve identificar o Production maono_maps.",
    );
  }
  return databaseId;
}

function normalizeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (!["disabled", "dry-run", "apply"].includes(mode)) {
    throw new Error(
      "MAONO_PURGE_OPERATOR_MODE deve ser disabled, dry-run ou apply.",
    );
  }
  return mode;
}

function assertCron(value) {
  const cron = String(value || "").trim();
  if (!/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(cron)) {
    throw new Error("MAONO_DOCUMENT_PURGE_CRON deve conter cinco campos.");
  }
  return cron;
}

function relativeConfigPath(target, repositoryPath) {
  return path
    .relative(path.dirname(target), path.join(REPOSITORY_ROOT, repositoryPath))
    .split(path.sep)
    .join("/");
}

export function renderDocumentPurgeWranglerConfig({
  mode,
  databaseId,
  cron = DEFAULT_CRON,
  batchSize = 25,
  claimTtlSeconds = 900,
  outputPath = ".tmp/wrangler.document-purge.toml",
} = {}) {
  const safeMode = normalizeMode(mode);
  const safeDatabaseId = assertDatabaseId(databaseId);
  const safeBatchSize = boundedInteger(
    batchSize,
    "MAONO_DOCUMENT_PURGE_BATCH_SIZE",
    1,
    25,
  );
  const safeClaimTtl = boundedInteger(
    claimTtlSeconds,
    "MAONO_DOCUMENT_PURGE_CLAIM_TTL_SECONDS",
    30,
    3600,
  );
  const safeCron = assertCron(cron);
  const target = path.resolve(outputPath);
  const enabled = safeMode !== "disabled";
  const killSwitch = safeMode === "disabled";
  const dryRun = safeMode !== "apply";

  return `name = "${WORKER_NAME}"
account_id = "${PURGE_PRODUCTION_ACCOUNT_ID}"
main = ${JSON.stringify(relativeConfigPath(target, MAIN))}
compatibility_date = "${COMPATIBILITY_DATE}"

[vars]
MAONO_DOCUMENT_PURGE_ENABLED = "${enabled}"
MAONO_DOCUMENT_PURGE_KILL_SWITCH = "${killSwitch}"
MAONO_DOCUMENT_PURGE_DRY_RUN = "${dryRun}"
MAONO_DOCUMENT_PURGE_BATCH_SIZE = "${safeBatchSize}"
MAONO_DOCUMENT_PURGE_CLAIM_TTL_SECONDS = "${safeClaimTtl}"

[[d1_databases]]
binding = "DB"
database_name = "maono_maps"
database_id = "${safeDatabaseId}"
migrations_dir = ${JSON.stringify(relativeConfigPath(target, "migrations"))}

[triggers]
crons = [${JSON.stringify(safeCron)}]
`;
}

export async function writeDocumentPurgeWranglerConfig({
  outputPath,
  ...options
} = {}) {
  const target = path.resolve(
    outputPath || ".tmp/wrangler.document-purge.toml",
  );
  const content = renderDocumentPurgeWranglerConfig({
    ...options,
    outputPath: target,
  });
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return target;
}

async function main() {
  const target = await writeDocumentPurgeWranglerConfig({
    outputPath:
      process.env.MAONO_PURGE_CONFIG_PATH ||
      ".tmp/wrangler.document-purge.toml",
    mode: process.env.MAONO_PURGE_OPERATOR_MODE,
    databaseId: process.env.MAONO_PURGE_D1_DATABASE_ID,
    cron: process.env.MAONO_DOCUMENT_PURGE_CRON || DEFAULT_CRON,
    batchSize: process.env.MAONO_DOCUMENT_PURGE_BATCH_SIZE || 25,
    claimTtlSeconds:
      process.env.MAONO_DOCUMENT_PURGE_CLAIM_TTL_SECONDS || 900,
  });
  process.stdout.write(`${target}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error?.message || "Falha ao gerar configuração de purge.");
    process.exitCode = 1;
  });
}
