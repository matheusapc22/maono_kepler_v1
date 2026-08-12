import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DATA_ROOT = path.resolve(process.cwd(), ".benchmark-data/s08");
const RESULTS_DIR = path.join(DATA_ROOT, "results");
const REPORT_DIR = path.join(DATA_ROOT, "reports");

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

function numeric(results, pathParts) {
  return results
    .map((result) => pathParts.reduce((value, key) => value?.[key], result))
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

function summarizeMetric(results, pathParts) {
  const values = numeric(results, pathParts);
  return {
    count: values.length,
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

function keyFor(result) {
  return `${result.deviceClass}::${result.fixtureId}::${result.cacheMode}`;
}

function summarizeGroup(results) {
  return {
    runs: results.length,
    success: results.filter((result) => result.outcome === "SUCCESS").length,
    failures: results.filter((result) => result.outcome !== "SUCCESS").length,
    input: results[0]?.input || null,
    metrics: {
      downloadTotalMs: summarizeMetric(results, ["metrics", "downloadTotalMs"]),
      browserJsonParseMs: summarizeMetric(results, ["metrics", "browserJsonParseMs"]),
      schemaLoadMs: summarizeMetric(results, ["metrics", "schemaLoadMs"]),
      addDataToMapDispatchMs: summarizeMetric(results, ["metrics", "addDataToMapDispatchMs"]),
      engineHydrationToReadyMs: summarizeMetric(results, ["metrics", "engineHydrationToReadyMs"]),
      mapReadyMs: summarizeMetric(results, ["metrics", "mapReadyMs"]),
      maxLongTaskMs: summarizeMetric(results, ["metrics", "maxLongTaskMs"]),
      averageFps: summarizeMetric(results, ["metrics", "averageFps"]),
      p95FrameMs: summarizeMetric(results, ["metrics", "p95FrameMs"]),
    },
  };
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
}

function markdown(summary) {
  const lines = [
    "# S08 — Benchmark Results",
    "",
    "> Este relatório descreve medições observadas. Ele não define políticas, limites ou classificação de risco.",
    "",
    `Runs coletados: **${summary.totalRuns}**`,
    "",
    "| Dispositivo | Fixture | Cache | Runs | Sucesso | MAP_READY mediana (ms) | Schema.load mediana (ms) | FPS mediana | Maior long task p95 (ms) |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const group of summary.groups) {
    lines.push(
      `| ${group.deviceClass} | ${group.fixtureId} | ${group.cacheMode} | ${group.summary.runs} | ${group.summary.success} | ${formatNumber(group.summary.metrics.mapReadyMs.median)} | ${formatNumber(group.summary.metrics.schemaLoadMs.median)} | ${formatNumber(group.summary.metrics.averageFps.median)} | ${formatNumber(group.summary.metrics.maxLongTaskMs.p95)} |`,
    );
  }
  lines.push(
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
      const [deviceClass, fixtureId, cacheMode] = key.split("::");
      return { deviceClass, fixtureId, cacheMode, summary: summarizeGroup(groupResults) };
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
