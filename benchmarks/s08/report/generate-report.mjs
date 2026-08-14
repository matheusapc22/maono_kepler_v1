import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DATA_ROOT = path.resolve(process.cwd(), ".benchmark-data/s08");
const RESULTS_DIR = path.join(DATA_ROOT, "results");
const REPORT_DIR = path.join(DATA_ROOT, "reports");
const OUTCOME_ORDER = [
  "SUCCESS",
  "WEBGL_CONTEXT_LOST",
  "TIMEOUT",
  "RELOAD",
  "ERROR",
  "PAGE_CRASH",
  "INCOMPLETE",
];

function quantile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function finiteMetricValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numeric(results, pathParts) {
  return results
    .map((result) => pathParts.reduce((value, key) => value?.[key], result))
    .map(finiteMetricValue)
    .filter((value) => value !== null);
}

function summarizeMetric(results, pathParts) {
  const values = numeric(results, pathParts);
  return {
    count: values.length,
    min: values.length ? Math.min(...values) : null,
    median: median(values),
    p75: quantile(values, 0.75),
    p95: quantile(values, 0.95),
    max: values.length ? Math.max(...values) : null,
  };
}

async function readResults() {
  let files = [];
  try {
    files = (await readdir(RESULTS_DIR)).filter((file) => file.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const results = [];
  for (const file of files) {
    const text = await readFile(path.join(RESULTS_DIR, file), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      results.push(JSON.parse(line));
    }
  }
  return results;
}

function normalizeCommit(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}

function keyFor(result) {
  return `${normalizeCommit(result.commit)}::${result.deviceClass}::${result.fixtureId}::${result.cacheMode}`;
}

function summarizeOutcomes(results) {
  const counts = {};
  for (const result of results) {
    const outcome = result.outcome || "INCOMPLETE";
    counts[outcome] = (counts[outcome] || 0) + 1;
  }
  return counts;
}

function summarizeMetrics(results) {
  return {
    downloadTotalMs: summarizeMetric(results, ["metrics", "downloadTotalMs"]),
    browserJsonParseMs: summarizeMetric(results, ["metrics", "browserJsonParseMs"]),
    schemaLoadMs: summarizeMetric(results, ["metrics", "schemaLoadMs"]),
    addDataToMapDispatchMs: summarizeMetric(results, ["metrics", "addDataToMapDispatchMs"]),
    engineHydrationToReadyMs: summarizeMetric(results, ["metrics", "engineHydrationToReadyMs"]),
    mapReadyMs: summarizeMetric(results, ["metrics", "mapReadyMs"]),
    maxLongTaskMs: summarizeMetric(results, ["metrics", "maxLongTaskMs"]),
    averageFps: summarizeMetric(results, ["metrics", "averageFps"]),
    p95FrameMs: summarizeMetric(results, ["metrics", "p95FrameMs"]),
    worstFrameMs: summarizeMetric(results, ["metrics", "worstFrameMs"]),
    droppedFrameCount: summarizeMetric(results, ["metrics", "droppedFrameCount"]),
  };
}

function summarizeGroup(results) {
  const successResults = results.filter((result) => result.outcome === "SUCCESS");
  const successWithDroppedFrames = successResults.filter((result) => {
    const dropped = finiteMetricValue(result?.metrics?.droppedFrameCount);
    return dropped !== null && dropped > 0;
  }).length;
  return {
    runs: results.length,
    success: successResults.length,
    failures: results.length - successResults.length,
    successWithDroppedFrames,
    outcomes: summarizeOutcomes(results),
    input: results[0]?.input || null,
    metrics: summarizeMetrics(results),
    successMetrics: summarizeMetrics(successResults),
  };
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "—";
}

function formatRatio(numerator, denominator) {
  if (!Number.isInteger(denominator) || denominator <= 0) return "—";
  return `${Number(numerator || 0)}/${denominator}`;
}

function formatCommit(value) {
  const commit = normalizeCommit(value);
  return commit === "unknown" ? commit : commit.slice(0, 8);
}

function formatOutcomes(outcomes) {
  const known = OUTCOME_ORDER
    .filter((outcome) => Number(outcomes?.[outcome] || 0) > 0)
    .map((outcome) => `${outcome}=${outcomes[outcome]}`);
  const extras = Object.entries(outcomes || {})
    .filter(([outcome, count]) => !OUTCOME_ORDER.includes(outcome) && Number(count) > 0)
    .map(([outcome, count]) => `${outcome}=${count}`);
  return [...known, ...extras].join("; ") || "—";
}

function markdown(summary) {
  const lines = [
    "# S08 — Benchmark Results",
    "",
    "> Este relatório descreve medições observadas. Ele não define políticas, limites ou classificação de risco.",
    "",
    `Runs coletados: **${summary.totalRuns}**`,
    "",
    "| Commit | Dispositivo | Fixture | Cache | Runs | Outcomes | MAP_READY mediana SUCCESS (ms) | Schema.load mediana SUCCESS (ms) | FPS mediana SUCCESS | FPS mínimo SUCCESS | Pior frame máximo SUCCESS (ms) | SUCCESS c/ dropped frames | Maior long task p95 TODOS (ms) |",
    "|---|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const group of summary.groups) {
    lines.push(
      `| ${formatCommit(group.commit)} | ${group.deviceClass} | ${group.fixtureId} | ${group.cacheMode} | ${group.summary.runs} | ${formatOutcomes(group.summary.outcomes)} | ${formatNumber(group.summary.successMetrics.mapReadyMs.median)} | ${formatNumber(group.summary.successMetrics.schemaLoadMs.median)} | ${formatNumber(group.summary.successMetrics.averageFps.median)} | ${formatNumber(group.summary.successMetrics.averageFps.min)} | ${formatNumber(group.summary.successMetrics.worstFrameMs.max)} | ${formatRatio(group.summary.successWithDroppedFrames, group.summary.success)} | ${formatNumber(group.summary.metrics.maxLongTaskMs.p95)} |`,
    );
  }
  lines.push(
    "",
    "## Leitura das falhas e stalls",
    "",
    "As medianas de MAP_READY, Schema.load e FPS usam somente runs SUCCESS. Ausência de runs SUCCESS é exibida como —, nunca como zero. A coluna de outcomes preserva falhas por tipo; Long Task p95 considera todos os runs que registraram essa métrica, inclusive falhas parciais.",
    "",
    "Para não esconder degradações transitórias atrás da mediana, o relatório também mostra o FPS mínimo, o pior frame máximo e quantos runs SUCCESS registraram ao menos um frame acima de 33,34 ms. Essas colunas continuam sendo evidência observada, não thresholds operacionais.",
    "",
    "Valores ausentes (`null`, `undefined` ou string vazia) são ignorados nas estatísticas numéricas e nunca convertidos implicitamente em zero.",
    "",
    "Os grupos também são separados pelo commit registrado no run, evitando misturar campanhas produzidas por instrumentações diferentes.",
    "",
    "## Próxima etapa",
    "",
    "Os resultados alimentam o Analyzer e a futura calibração. Nenhum threshold operacional é derivado automaticamente por este relatório.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const results = await readResults();
  const groups = new Map();
  for (const result of results) {
    const key = keyFor(result);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result);
  }

  const summary = {
    benchmarkVersion: "s08-benchmark-v1",
    generatedAt: new Date().toISOString(),
    totalRuns: results.length,
    groups: [...groups.entries()].map(([key, groupResults]) => {
      const [commit, deviceClass, fixtureId, cacheMode] = key.split("::");
      return { commit, deviceClass, fixtureId, cacheMode, summary: summarizeGroup(groupResults) };
    }),
  };

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(path.join(REPORT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(path.join(REPORT_DIR, "S08-benchmark-report.md"), `${markdown(summary)}\n`, "utf8");
  console.log(`[S08] Relatório gerado em ${REPORT_DIR}. Runs: ${results.length}`);
}

main().catch((error) => {
  console.error("[S08] Falha ao gerar relatório:", error);
  process.exitCode = 1;
});
