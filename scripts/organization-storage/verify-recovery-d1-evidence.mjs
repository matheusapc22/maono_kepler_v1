import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { RECOVERY_PRODUCTION_DATABASE_ID } from "./render-recovery-wrangler-config.mjs";

const MIGRATION = "0009_organization_storage_invariant.sql";
const INDEX = "idx_organizations_storage_status";

// This verifies the deployment prerequisite, not physical Dropbox readiness or SLOs.
export function verifyRecoveryD1Evidence({ databaseInfo, queryResults, recoveryInfo }) {
  if (databaseInfo?.uuid !== RECOVERY_PRODUCTION_DATABASE_ID || databaseInfo?.name !== "maono_maps") {
    throw new Error("A identidade remota do D1 não corresponde ao Production maono_maps.");
  }
  if (!Array.isArray(queryResults) || queryResults.length !== 4 ||
      queryResults.some((query) => query?.success !== true || !Array.isArray(query.results))) {
    throw new Error("Evidência D1 incompleta ou consulta sem sucesso.");
  }
  const [history, columns, indexes, indexColumns] = queryResults.map((query) => query.results);
  if (history.length !== 1 || history[0].name !== MIGRATION || !history[0].applied_at) {
    throw new Error("O histórico remoto não comprova uma aplicação única da migration 0009.");
  }
  for (const name of ["storage_status", "storage_error", "storage_checked_at"]) {
    const column = columns.find((item) => item.name === name);
    if (!column || String(column.type).toUpperCase() !== "TEXT" || column.notnull !== 0 || column.dflt_value !== null) {
      throw new Error(`Schema divergente na coluna ${name}; não reaplique a migration automaticamente.`);
    }
  }
  const index = indexes.find((item) => item.name === INDEX);
  if (!index || index.unique !== 0 || index.partial !== 0 ||
      indexColumns.length !== 1 || indexColumns[0].seqno !== 0 || indexColumns[0].name !== "storage_status") {
    throw new Error("Índice da migration 0009 ausente ou divergente.");
  }
  if (typeof recoveryInfo?.bookmark !== "string" || !recoveryInfo.bookmark.trim()) {
    throw new Error("Bookmark de recuperação D1 ausente; não habilite o Worker.");
  }
  return { database: "maono_maps", databaseId: databaseInfo.uuid, migration: MIGRATION, appliedAt: history[0].applied_at, bookmark: recoveryInfo.bookmark, verifiedAt: new Date().toISOString(), prerequisiteVerified: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [infoPath, queriesPath, recoveryPath] = process.argv.slice(2);
    if (!infoPath || !queriesPath || !recoveryPath) throw new Error("Informe os arquivos JSON de d1 info, d1 execute e d1 time-travel info.");
    const [databaseInfo, queryResults, recoveryInfo] = await Promise.all([infoPath, queriesPath, recoveryPath].map(async (file) => JSON.parse(await readFile(file, "utf8"))));
    process.stdout.write(`${JSON.stringify(verifyRecoveryD1Evidence({ databaseInfo, queryResults, recoveryInfo }), null, 2)}\n`);
  } catch (error) {
    console.error(error?.message || "Falha ao verificar o pré-requisito D1.");
    process.exitCode = 1;
  }
}
