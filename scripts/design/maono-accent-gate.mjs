import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

const SCAN_ROOTS = [
  "src/maono-design-tokens.css",
  "src/pages/Projects",
  "src/pages/Admin",
  "src/pages/login.css",
  "src/pages/maono-login-accent.css",
];

const SOURCE_EXTENSIONS = new Set([".css", ".ts", ".tsx", ".js", ".jsx"]);

/*
 * Dívida histórica congelada. Estes arquivos são anteriores ao design system e
 * ainda carregam literais antigos no CSS estrutural. Eles podem perder dívida,
 * mas código novo não pode copiá-la. A camada de compatibilidade neutraliza os
 * aliases no runtime até a futura decomposição desses monólitos.
 */
const FROZEN_LEGACY_FILES = new Set([
  "src/pages/Projects/projects.css",
  "src/pages/Projects/components/project-cards.css",
  "src/pages/Projects/components/project-metadata-panel.css",
]);

const COMPAT_FILE = "src/pages/Projects/maono-residual-accent.css";

const LEGACY_BRAND_PATTERNS = [
  ["legacy teal literal", /#20c7b5/gi],
  ["legacy mint literal", /#67e8dd/gi],
  ["legacy mint text", /#9af5eb/gi],
  ["legacy mint text", /#99f6e4/gi],
  ["legacy emerald literal", /#34d399/gi],
  ["legacy emerald text", /#6ee7b7/gi],
  ["legacy teal rgb", /rgba?\(\s*32\s*,\s*199\s*,\s*181\b/gi],
  ["legacy emerald rgb", /rgba?\(\s*52\s*,\s*211\s*,\s*153\b/gi],
  ["legacy mint rgb", /rgba?\(\s*110\s*,\s*231\s*,\s*183\b/gi],
];

const RAW_GOLD_ALIAS_PATTERNS = [
  ["raw --mm-gold", /--mm-gold\s*:\s*#[0-9a-f]{3,8}/gi],
  ["raw --mm-gold-bright", /--mm-gold-bright\s*:\s*#[0-9a-f]{3,8}/gi],
  ["raw --mm-gold-muted", /--mm-gold-muted\s*:\s*#[0-9a-f]{3,8}/gi],
  ["raw --admin-gold", /--admin-gold\s*:\s*#[0-9a-f]{3,8}/gi],
  ["raw --admin-gold-bright", /--admin-gold-bright\s*:\s*#[0-9a-f]{3,8}/gi],
];

async function walk(entry) {
  const absolute = path.join(ROOT, entry);
  const stat = await import("node:fs/promises").then(({ stat }) => stat(absolute));

  if (stat.isFile()) return [entry.replaceAll("\\", "/")];

  const files = [];
  for (const dirent of await readdir(absolute, { withFileTypes: true })) {
    const child = path.join(entry, dirent.name).replaceAll("\\", "/");
    if (dirent.isDirectory()) files.push(...(await walk(child)));
    else if (SOURCE_EXTENSIONS.has(path.extname(dirent.name))) files.push(child);
  }
  return files;
}

function countMatches(source, regex) {
  return [...source.matchAll(new RegExp(regex.source, regex.flags))].length;
}

const files = [...new Set((await Promise.all(SCAN_ROOTS.map(walk))).flat())].sort();
const violations = [];
const frozenDebt = [];

for (const file of files) {
  const source = await readFile(path.join(ROOT, file), "utf8");
  const normalized = source.toLowerCase();
  const frozen = FROZEN_LEGACY_FILES.has(file);

  if (frozen) {
    let debt = 0;
    for (const [, pattern] of LEGACY_BRAND_PATTERNS) debt += countMatches(source, pattern);
    debt += countMatches(source, /--mm-teal\b/gi);
    debt += RAW_GOLD_ALIAS_PATTERNS.reduce(
      (total, [, pattern]) => total + countMatches(source, pattern),
      0,
    );
    if (debt > 0) frozenDebt.push(`${file}: ${debt} ocorrência(s) congelada(s)`);
    continue;
  }

  for (const [label, pattern] of LEGACY_BRAND_PATTERNS) {
    const count = countMatches(source, pattern);
    if (count > 0) violations.push(`${file}: ${label} (${count})`);
  }

  for (const [label, pattern] of RAW_GOLD_ALIAS_PATTERNS) {
    const count = countMatches(source, pattern);
    if (count > 0) violations.push(`${file}: ${label} (${count})`);
  }

  const tealMentions = countMatches(source, /--mm-teal\b/gi);
  if (file === COMPAT_FILE) {
    const allowedTombstone = /--mm-teal\s*:\s*var\(--maono-accent\)\s*;/i.test(source);
    const legacyConsumption = /var\(--mm-teal\)/i.test(source);
    if (!allowedTombstone) {
      violations.push(`${file}: tombstone --mm-teal precisa apontar para --maono-accent`);
    }
    if (legacyConsumption) {
      violations.push(`${file}: a camada moderna não pode consumir var(--mm-teal)`);
    }
    if (tealMentions !== 1) {
      violations.push(`${file}: esperado exatamente 1 tombstone --mm-teal; encontrado ${tealMentions}`);
    }
  } else if (tealMentions > 0) {
    violations.push(`${file}: alias --mm-teal proibido fora do arquivo legado/compatibilidade (${tealMentions})`);
  }

  /* Verde funcional é permitido somente via tokens semânticos na camada moderna. */
  if (
    normalized.includes("is-success") ||
    normalized.includes("status-completed") ||
    normalized.includes(".active")
  ) {
    // Não falha por nome de estado; a regra acima bloqueia apenas a antiga paleta de marca.
  }
}

const compat = await readFile(path.join(ROOT, COMPAT_FILE), "utf8");
for (const contract of [
  /--mm-gold\s*:\s*var\(--maono-accent-strong\)/i,
  /--mm-gold-bright\s*:\s*var\(--maono-accent-bright\)/i,
  /--mm-gold-muted\s*:\s*var\(--maono-accent-muted\)/i,
  /--mm-danger\s*:\s*var\(--maono-semantic-danger\)/i,
  /--mm-success\s*:\s*var\(--maono-semantic-success\)/i,
]) {
  if (!contract.test(compat)) violations.push(`${COMPAT_FILE}: bridge canônico incompleto (${contract})`);
}

if (violations.length > 0) {
  console.error("\nMaõno accent gate: FAILED\n");
  for (const violation of violations) console.error(`- ${violation}`);
  if (frozenDebt.length) {
    console.error("\nDívida histórica congelada (não ampliável por arquivos modernos):");
    for (const debt of frozenDebt) console.error(`- ${debt}`);
  }
  process.exit(1);
}

console.log("Maõno accent gate: OK");
if (frozenDebt.length) {
  console.log("Dívida histórica congelada e neutralizada no runtime:");
  for (const debt of frozenDebt) console.log(`- ${debt}`);
}
