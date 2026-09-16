#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

export const RATCHET_RULES = [
  "raw-error-message",
  "raw-response-text",
  "diagnostic-id",
];

export const RULES = [
  {
    id: "raw-error-message",
    description: "Propagação de Error.message ou payload/state error.message",
    pattern: /\b(?:error|err|state\.error|payload\.error|data\.error|requestError|governanceError)\.message\b/g,
  },
  {
    id: "raw-response-text",
    description: "Leitura de corpo textual de resposta que pode virar mensagem visual",
    pattern: /\b(?:response|res)\.text\s*\(/g,
  },
  {
    id: "diagnostic-id",
    description: "Metadado operacional que não deve compor copy pública sem normalização",
    pattern: /\b(?:requestId|correlationId|stage)\b/g,
  },
  {
    id: "implementation-copy",
    description: "Vocabulário de implementação encontrado em string/linha de frontend; regra de descoberta, não gate automático",
    pattern: /\b(?:API|backend|storage|Worker|descriptor|bytes|body|JSON|schema|runtime|Kepler|dataset(?:s)?|layer(?:s)?)\b/gi,
  },
];

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "build", "dist", "coverage"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else if (entry.isFile() && isSourceFile(fullPath)) files.push(fullPath);
  }
  return files;
}

function compactSnippet(line) {
  return line.trim().replace(/\s+/g, " ").slice(0, 220);
}

export function scanText(text, relativePath = "fixture.tsx") {
  const findings = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      if (!rule.pattern.test(line)) continue;

      findings.push({
        rule: rule.id,
        file: relativePath.replaceAll(path.sep, "/"),
        line: index + 1,
        snippet: compactSnippet(line),
      });
    }
  }

  return findings;
}

export function scanRepository(sourceRoot = SOURCE_ROOT) {
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Diretório de fontes não encontrado: ${sourceRoot}`);
  }

  const findings = [];
  for (const filePath of walk(sourceRoot).sort()) {
    const relativePath = path.relative(ROOT, filePath);
    const text = fs.readFileSync(filePath, "utf8");
    findings.push(...scanText(text, relativePath));
  }
  return findings;
}

export function summarize(findings) {
  const byRule = {};
  const byFile = {};
  for (const finding of findings) {
    byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
    const key = `${finding.file}::${finding.rule}`;
    byFile[key] = (byFile[key] ?? 0) + 1;
  }
  return {
    total: findings.length,
    byRule: Object.fromEntries(Object.entries(byRule).sort()),
    byFile: Object.fromEntries(Object.entries(byFile).sort()),
  };
}

function readBaseline(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ruleFromKey(key) {
  return key.slice(key.lastIndexOf("::") + 2);
}

export function buildBaseline(summary) {
  const allowed = new Set(RATCHET_RULES);
  const byFile = Object.fromEntries(
    Object.entries(summary.byFile ?? {}).filter(([key]) => allowed.has(ruleFromKey(key))),
  );
  return {
    version: 2,
    generatedFrom: "phase0",
    rules: RATCHET_RULES,
    byFile,
  };
}

export function compareWithBaseline(summary, baseline) {
  const regressions = [];
  const expected = baseline?.byFile ?? {};
  const rules = new Set(
    Array.isArray(baseline?.rules) && baseline.rules.length
      ? baseline.rules
      : RATCHET_RULES,
  );
  const actual = Object.fromEntries(
    Object.entries(summary.byFile ?? {}).filter(([key]) => rules.has(ruleFromKey(key))),
  );
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);

  for (const key of [...keys].sort()) {
    const before = Number(expected[key] ?? 0);
    const now = Number(actual[key] ?? 0);
    if (now > before) regressions.push({ key, before, now });
  }
  return regressions;
}

function printHuman(findings, summary) {
  console.log(`# Product Reliability / UX error-sink audit`);
  console.log(`Total candidate findings: ${summary.total}`);
  for (const [rule, count] of Object.entries(summary.byRule)) {
    const gate = RATCHET_RULES.includes(rule) ? "ratchet" : "review-only";
    console.log(`- ${rule}: ${count} (${gate})`);
  }
  console.log("\nFindings:");
  for (const finding of findings) {
    console.log(`${finding.file}:${finding.line} [${finding.rule}] ${finding.snippet}`);
  }
}

function parseArgs(argv) {
  const args = { json: false, baseline: null, writeBaseline: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") args.json = true;
    else if (value === "--baseline") args.baseline = argv[++index];
    else if (value === "--write-baseline") args.writeBaseline = argv[++index];
    else throw new Error(`Argumento desconhecido: ${value}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const findings = scanRepository();
  const summary = summarize(findings);
  const report = {
    generatedAt: new Date().toISOString(),
    sourceRoot: "src",
    ratchetRules: RATCHET_RULES,
    rules: RULES.map(({ id, description }) => ({ id, description })),
    summary,
    findings,
  };

  if (args.writeBaseline) {
    const baselinePath = path.resolve(ROOT, args.writeBaseline);
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(
      baselinePath,
      `${JSON.stringify(buildBaseline(summary), null, 2)}\n`,
      "utf8",
    );
    console.log(`Baseline gravado em ${path.relative(ROOT, baselinePath)}`);
  }

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printHuman(findings, summary);

  if (args.baseline) {
    const baseline = readBaseline(path.resolve(ROOT, args.baseline));
    const regressions = compareWithBaseline(summary, baseline);
    if (regressions.length > 0) {
      console.error("\nNovos sinks/regressões high-signal acima do baseline:");
      for (const regression of regressions) {
        console.error(`- ${regression.key}: ${regression.before} -> ${regression.now}`);
      }
      process.exitCode = 1;
    } else {
      console.log("\nRatchet OK: nenhum sink high-signal aumentou acima do baseline.");
    }
  }
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectExecution) main();
