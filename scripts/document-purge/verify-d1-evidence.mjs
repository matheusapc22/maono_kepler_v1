import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PURGE_PRODUCTION_DATABASE_ID } from "./render-wrangler-config.mjs";

const MIGRATION = "0024_document_folders_trash.sql";
const INDEX = "idx_organization_files_purge_queue";
const REQUIRED_COLUMNS = [
  "folder_id",
  "deleted_by",
  "purge_after",
  "trashed_from_folder_id",
  "purged_at",
];

export function verifyDocumentPurgeD1Evidence({
  databaseInfo,
  queryResults,
  recoveryInfo,
}) {
  if (
    databaseInfo?.uuid !== PURGE_PRODUCTION_DATABASE_ID ||
    databaseInfo?.name !== "maono_maps"
  ) {
    throw new Error(
      "A identidade remota do D1 não corresponde ao Production maono_maps.",
    );
  }
  if (
    !Array.isArray(queryResults) ||
    queryResults.length !== 4 ||
    queryResults.some(
      (query) => query?.success !== true || !Array.isArray(query.results),
    )
  ) {
    throw new Error("Evidência D1 incompleta ou consulta sem sucesso.");
  }

  const [history, columns, indexes, indexColumns] =
    queryResults.map((query) => query.results);

  if (
    history.length !== 1 ||
    history[0].name !== MIGRATION ||
    !history[0].applied_at
  ) {
    throw new Error(
      "O histórico remoto não comprova a migration 0024 no banco alvo.",
    );
  }

  for (const name of REQUIRED_COLUMNS) {
    if (!columns.some((column) => column.name === name)) {
      throw new Error(`Schema divergente: coluna ${name} ausente.`);
    }
  }

  const index = indexes.find((item) => item.name === INDEX);
  if (!index || index.unique !== 0 || index.partial !== 1) {
    throw new Error("Índice de purge 0024 ausente ou divergente.");
  }

  const names = indexColumns
    .sort((a, b) => a.seqno - b.seqno)
    .map((item) => item.name);
  if (
    names.length !== 2 ||
    names[0] !== "purge_after" ||
    names[1] !== "purged_at"
  ) {
    throw new Error("Colunas do índice de purge divergentes.");
  }

  if (
    typeof recoveryInfo?.bookmark !== "string" ||
    !recoveryInfo.bookmark.trim()
  ) {
    throw new Error(
      "Bookmark Time Travel ausente; não habilite o Worker.",
    );
  }

  return {
    database: "maono_maps",
    databaseId: databaseInfo.uuid,
    migration: MIGRATION,
    appliedAt: history[0].applied_at,
    bookmark: recoveryInfo.bookmark,
    verifiedAt: new Date().toISOString(),
    prerequisiteVerified: true,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [infoPath, queriesPath, recoveryPath] = process.argv.slice(2);
    if (!infoPath || !queriesPath || !recoveryPath) {
      throw new Error(
        "Informe os arquivos JSON de d1 info, d1 execute e d1 time-travel info.",
      );
    }
    const [databaseInfo, queryResults, recoveryInfo] = await Promise.all(
      [infoPath, queriesPath, recoveryPath].map(async (file) =>
        JSON.parse(await readFile(file, "utf8")),
      ),
    );
    process.stdout.write(
      `${JSON.stringify(
        verifyDocumentPurgeD1Evidence({
          databaseInfo,
          queryResults,
          recoveryInfo,
        }),
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    console.error(error?.message || "Falha ao verificar o D1 de purge.");
    process.exitCode = 1;
  }
}
