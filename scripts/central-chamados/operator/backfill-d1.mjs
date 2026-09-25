#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  initialOperatorReport, operatorError, parseOperatorArgs, readOnlyD1, runOperator,
} from "./lib.mjs";

const exec = promisify(execFile);
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
export const OPERATOR_HELP = `CC-03 — operador remoto D1 (sem endpoint, deploy ou migração)

Inventário somente leitura, padrão, organizações ativas:
  node scripts/central-chamados/operator/backfill-d1.mjs --database-name maono_maps --database-id 5bc4dc32-f3bd-4c92-bbd1-cbda63e467db --report ./inventario-novo.json

Aplique uma organização explicitamente, após revisar inventário e suspender escritores:
  node scripts/central-chamados/operator/backfill-d1.mjs --mode apply --database-name maono_maps --database-id 5bc4dc32-f3bd-4c92-bbd1-cbda63e467db --organization-id ID --operator-user-id ID_SUPER_ADMIN --fallback-user-id ID_MEMBRO --confirm-database-id 5bc4dc32-f3bd-4c92-bbd1-cbda63e467db --writers-paused --page-size 50 --max-pages 1 --report ./aplicacao-nova.json

Reconcilie somente uma fonte vazia, sem importar chamados ou atribuir autoria:
  node scripts/central-chamados/operator/backfill-d1.mjs --mode reconcile-empty --database-name maono_maps --database-id 5bc4dc32-f3bd-4c92-bbd1-cbda63e467db --organization-id ID --operator-user-id ID_SUPER_ADMIN --confirm-database-id 5bc4dc32-f3bd-4c92-bbd1-cbda63e467db --writers-paused --report ./reconciliacao-vazia-nova.json
reconcile-empty rejeita --fallback-user-id e qualquer fonte legada elegível não vazia.

--organization-id também limita o inventário e mostra candidatos a autor substituto.
--account-id HEX32 é opcional; autenticação normal do Wrangler continua necessária.
--report é obrigatório: arquivo novo, diretório já existente, criação exclusiva.
Aplicação captura automaticamente o bookmark ATUAL do Time Travel antes de escrever.
--writers-paused é um atestado humano; o programa não verifica a suspensão.
Saídas: 0 concluído; 1 erro; 2 páginas esgotadas/pendências, com efeitos parciais duráveis.
Nenhuma flag da aplicação é alterada. O modo padrão inventory não escreve no banco.
`;

export function isolatedWranglerConfig(options) {
  return { name: "maono-ticket-backfill-operator", compatibility_date: "2026-09-25",
    ...(options.accountId ? { account_id: options.accountId } : {}),
    d1_databases: [{ binding: "DB", database_name: options.databaseName, database_id: options.databaseId, remote: true }] };
}
export async function runPinnedWranglerJson(args, configPath, {
  execCommand = exec,
  readPackage = async () => JSON.parse(await readFile(join(PACKAGE_DIR, "node_modules/wrangler/package.json"), "utf8")),
} = {}) {
  let packageJson;
  try {
    packageJson = await readPackage();
  } catch {
    throw operatorError("OPERATOR_WRANGLER_INSTALLATION", "Não foi possível ler a instalação isolada do Wrangler. Execute npm ci no pacote do operador.");
  }
  if (packageJson?.version !== "4.140.0") throw operatorError("OPERATOR_WRANGLER_VERSION", "Instale a dependência isolada fixada em Wrangler 4.140.0.");
  let result;
  try {
    result = await execCommand(process.execPath, [join(PACKAGE_DIR, "node_modules/wrangler/bin/wrangler.js"), ...args, "--config", configPath, "--json"], {
      cwd: dirname(configPath), shell: false, windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024,
      // Wrangler 4.140 emits d1 info/time-travel JSON through logger.log.
      // "none" suppresses the result itself, not just diagnostic noise.
      // Output remains captured here; never forward raw stdout/stderr.
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG: "log", WRANGLER_WRITE_LOGS: "false", CI: "true" },
    });
  } catch {
    throw operatorError("OPERATOR_WRANGLER_COMMAND_FAILED", "O Wrangler encerrou a consulta D1 com erro. Verifique autenticação e acesso à conta/banco; a resposta interna foi omitida.");
  }
  const output = typeof result?.stdout === "string" ? result.stdout.trim() : "";
  if (!output) throw operatorError("OPERATOR_WRANGLER_EMPTY_OUTPUT", "O Wrangler concluiu a consulta sem devolver JSON. Verifique a versão do operador e a configuração de saída; isso não comprova falha de autenticação.");
  try {
    const parsed = JSON.parse(output);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid shape");
    return parsed;
  } catch {
    throw operatorError("OPERATOR_WRANGLER_INVALID_JSON", "O Wrangler devolveu uma resposta fora do contrato JSON esperado. A resposta interna foi omitida; nenhuma identidade foi presumida.");
  }
}
export async function verifyRemoteBinding(db) {
  const probe = await readOnlyD1(db).prepare("SELECT 1 AS operator_probe").all();
  const servedBy = probe?.meta?.served_by;
  if (probe?.success !== true || probe.results?.[0]?.operator_probe !== 1 || typeof servedBy !== "string" || !servedBy || /miniflare|local|workerd/i.test(servedBy)) {
    throw operatorError("OPERATOR_REMOTE_BINDING_UNVERIFIED", "O binding não comprovou atendimento remoto pelo D1. A aplicação foi bloqueada.");
  }
  return { remote: true, servedBy, servedByRegion: typeof probe.meta.served_by_region === "string" ? probe.meta.served_by_region : null };
}
function safeFailure(error) {
  return error?.operatorSafe ? { code: error.code, message: error.message }
    : { code: "OPERATOR_RUNTIME_FAILED", message: "Falha no operador. Detalhes internos foram omitidos; revise o relatório antes de repetir." };
}

/** Dependency injection is only for local tests. CLI always uses pinned Wrangler. */
export async function main(argv = process.argv.slice(2), injected = {}) {
  let options; let handle; let temporary; let proxy; let report; let exitCode = 1;
  const output = injected.output || ((text) => process.stdout.write(text));
  const signals = injected.signals || process;
  const previousLog = process.env.WRANGLER_LOG;
  const previousMetrics = process.env.WRANGLER_SEND_METRICS;
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  const persist = async (value) => {
    if (!handle) return;
    try {
      const text = `${JSON.stringify(value, null, 2)}\n`;
      await handle.write(text, 0, "utf8"); await handle.truncate(Buffer.byteLength(text)); await handle.sync();
    } catch { throw operatorError("OPERATOR_REPORT_WRITE_FAILED", "Não foi possível atualizar o relatório. Nenhuma página adicional será iniciada."); }
  };
  try {
    options = parseOperatorArgs(argv);
    if (options.help) { output(OPERATOR_HELP); return 0; }
    // Fail before authentication, a remote session or database writes if the
    // destination already exists or its parent is missing/unwritable.
    try { handle = await open(resolve(options.reportPath), "wx", 0o600); }
    catch { throw operatorError("OPERATOR_REPORT_UNAVAILABLE", "O relatório precisa ser um arquivo novo em diretório existente e gravável; nenhum acesso remoto foi iniciado."); }
    report = initialOperatorReport(options);
    report.phase = "initializing";
    await persist(report);
    signals.on("SIGINT", interrupt); signals.on("SIGTERM", interrupt);
    temporary = await mkdtemp(join(tmpdir(), "maono-ticket-operator-"));
    const configPath = join(temporary, "wrangler.json");
    await writeFile(configPath, `${JSON.stringify(isolatedWranglerConfig(options), null, 2)}\n`, { mode: 0o600 });
    const wranglerJson = injected.wranglerJson || runPinnedWranglerJson;
    const info = await wranglerJson(["d1", "info", options.databaseName], configPath);
    const identity = { name: info.name, id: info.uuid };
    if (identity.name !== options.databaseName || identity.id !== options.databaseId) throw operatorError("OPERATOR_IDENTITY_MISMATCH", "O nome e UUID retornados pelo D1 não correspondem ao destino solicitado.");
    report.database = { ...report.database, verified: true, ...identity };
    let backup = null;
    if (options.mode !== "inventory") {
      const result = await wranglerJson(["d1", "time-travel", "info", options.databaseName], configPath);
      if (!/^[a-zA-Z0-9._:-]{10,200}$/.test(result.bookmark || "")) throw operatorError("OPERATOR_BACKUP_UNAVAILABLE", "O D1 não retornou um bookmark atual válido. A aplicação foi bloqueada.");
      backup = { bookmark: result.bookmark, capturedAt: new Date().toISOString() };
      report.backup = { ...backup, source: "wrangler_d1_time_travel_info" };
    }
    if (controller.signal.aborted) throw operatorError("OPERATOR_INTERRUPTED", "Operação interrompida antes de iniciar o processamento.");
    // Import lazily: --help, argument errors and report errors never load or
    // initialize Wrangler. envFiles:[] prevents repository .env inheritance.
    process.env.WRANGLER_LOG = "none";
    process.env.WRANGLER_SEND_METRICS = "false";
    const getPlatformProxy = injected.getPlatformProxy || (await import("wrangler")).getPlatformProxy;
    proxy = await getPlatformProxy({ configPath, persist: false, remoteBindings: true, envFiles: [] });
    report.binding = await verifyRemoteBinding(proxy.env.DB);
    report.phase = "preflight";
    await persist(report);
    const result = await runOperator(proxy.env, options, { identity, backup, runId: report.runId, signal: controller.signal,
      onProgress: async (progress) => persist({ ...progress, binding: report.binding, phase: "applying" }) });
    report = { ...result.report, binding: report.binding, phase: "finished" };
    exitCode = result.exitCode;
  } catch (error) {
    report = { ...(report || { reportVersion: 1, generatedAt: new Date().toISOString() }), ok: false, complete: false, phase: "failed", error: safeFailure(error) };
    exitCode = 1;
  } finally {
    signals.removeListener("SIGINT", interrupt); signals.removeListener("SIGTERM", interrupt);
    try { await proxy?.dispose(); }
    catch { if (report) { report.cleanupError = "OPERATOR_PROXY_DISPOSE_FAILED"; exitCode = 1; } }
    try { if (temporary) await rm(temporary, { recursive: true, force: true }); }
    catch { if (report) { report.cleanupError = "OPERATOR_TEMP_CLEANUP_FAILED"; exitCode = 1; } }
    if (report) {
      report.finishedAt = new Date().toISOString(); report.exitCode = exitCode;
      try { await persist(report); }
      catch { report.reportWriteError = "OPERATOR_REPORT_WRITE_FAILED"; report.exitCode = 1; exitCode = 1; }
      try { output(`${JSON.stringify(report, null, 2)}\n`); } catch { exitCode = 1; }
    }
    try { await handle?.close(); } catch { exitCode = 1; }
    if (previousLog === undefined) delete process.env.WRANGLER_LOG; else process.env.WRANGLER_LOG = previousLog;
    if (previousMetrics === undefined) delete process.env.WRANGLER_SEND_METRICS; else process.env.WRANGLER_SEND_METRICS = previousMetrics;
  }
  return exitCode;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
