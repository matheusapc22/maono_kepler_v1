#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { inspectTicketLegacyBackfill, runTicketLegacyBackfillPage } from "../../functions/_lib/ticket-legacy-backfill.js";

const help = `CC-03 — backfill explícito, somente arquivo SQLite local

Inspeção (somente leitura, padrão):
  node scripts/central-chamados/backfill-ticket-legacy.mjs --sqlite /caminho/copia.sqlite --organization 1 --database-identity copia-local

Aplicação local, limitada a uma página de 50 registros por padrão:
  node scripts/central-chamados/backfill-ticket-legacy.mjs --sqlite /caminho/copia.sqlite --organization 1 --database-identity copia-local --operator 7 --apply

Opções: --fallback-user ID (padrão: operador), --page-size 1..100,
        --max-pages 1..10000, --report /caminho/relatorio.json

Não cria banco, não aplica migrations, não chama Wrangler, não aceita --remote.
O operador deve usar uma cópia local autorizada; a identidade é registrada no relatório.
Sem --apply o arquivo é aberto pelo SQLite em modo read-only.
`;

function parseArgs(args) {
  const boolean = new Set(["apply", "help"]);
  const names = new Set(["sqlite", "organization", "database-identity", "operator", "fallback-user", "page-size", "max-pages", "report"]);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index].replace(/^--/, "");
    if (!args[index].startsWith("--") || (!boolean.has(name) && !names.has(name)) || name in options) {
      throw new Error(`Opção inválida ou repetida: ${args[index]}`);
    }
    if (boolean.has(name)) options[name] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Valor ausente: --${name}`);
      options[name] = value;
    }
  }
  return options;
}

function integer(value, fallback, min, max, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} fora do intervalo ${min}..${max}.`);
  return parsed;
}

function sqliteAdapter(sqlite) {
  const DB = {
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { const row = sqlite.prepare(sql).get(...values); return row ? { ...row } : null; },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...values).map((row) => ({ ...row })) }; },
        async run() {
          const statement = sqlite.prepare(sql);
          const results = statement.columns().length ? statement.all(...values).map((row) => ({ ...row })) : [];
          if (!statement.columns().length) statement.run(...values);
          const meta = sqlite.prepare("SELECT changes() AS changes, last_insert_rowid() AS last_row_id").get();
          return { success: true, results, meta: { ...meta } };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { DB };
}

let sqlite;
let reportPath;
let context = {};
function emit(report) {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) writeFileSync(reportPath, text, { mode: 0o600 });
  process.stdout.write(text);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(help);
  } else {
    if (!options.sqlite || !isAbsolute(options.sqlite) || !existsSync(options.sqlite)) throw new Error("--sqlite deve apontar para um arquivo local existente, com caminho absoluto.");
    if (!options["database-identity"]?.trim()) throw new Error("--database-identity é obrigatório para identificar a cópia local.");
    const requestedReport = options.report ? resolve(options.report) : null;
    const databaseStat = statSync(options.sqlite);
    if (!databaseStat.isFile()) throw new Error("--sqlite deve apontar para um arquivo regular.");
    const reportStat = requestedReport && existsSync(requestedReport) ? statSync(requestedReport) : null;
    if (requestedReport === resolve(options.sqlite) || (reportStat && reportStat.dev === databaseStat.dev && reportStat.ino === databaseStat.ino)) {
      throw new Error("O relatório não pode sobrescrever o banco.");
    }
    reportPath = requestedReport;
    const organizationId = integer(options.organization, 0, 1, Number.MAX_SAFE_INTEGER, "organization");
    const pageSize = integer(options["page-size"], 50, 1, 100, "page-size");
    const maxPages = integer(options["max-pages"], 1, 1, 10000, "max-pages");
    context = { mode: options.apply ? "local-apply" : "read-only", databaseIdentity: options["database-identity"].trim(),
      localPath: resolve(options.sqlite), organizationId, generatedAt: new Date().toISOString() };
    sqlite = new DatabaseSync(options.sqlite, { readOnly: !options.apply });
    sqlite.exec("PRAGMA foreign_keys = ON");
    const env = sqliteAdapter(sqlite);
    if (!options.apply) {
      emit({ ...context, ...(await inspectTicketLegacyBackfill(env, organizationId)) });
    } else {
      const operatorUserId = integer(options.operator, 0, 1, Number.MAX_SAFE_INTEGER, "operator");
      const fallbackUserId = integer(options["fallback-user"], operatorUserId, 1, Number.MAX_SAFE_INTEGER, "fallback-user");
      const runId = crypto.randomUUID();
      const pages = [];
      let afterLegacyId = 0;
      for (let index = 0; index < maxPages; index += 1) {
        const page = await runTicketLegacyBackfillPage(env, { organizationId, operatorUserId, fallbackUserId, pageSize, afterLegacyId, runId });
        pages.push(page);
        afterLegacyId = page.lastLegacyId;
        if (page.complete || page.scanned === 0) break;
      }
      const final = pages.at(-1);
      emit({ ...context, runId, operatorUserId, fallbackUserId, migrated: pages.reduce((sum, page) => sum + page.migrated, 0),
        complete: final?.complete === true, pages, nextAction: final?.complete ? "Revisar relatório e gates antes do cutover." : "Reexecutar o job após revisar as pendências; não ativar o cutover." });
    }
  }
} catch (error) {
  emit({ ...context, ok: false, code: error.code || "TICKET_BACKFILL_OPERATOR_ERROR", error: error.message,
    report: error.backfillReport || null, reportError: error.backfillReportError || null });
  process.exitCode = 1;
} finally {
  sqlite?.close();
}
