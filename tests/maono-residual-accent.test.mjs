import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

const [
  tokens,
  main,
  adminAccent,
  loginAccent,
  ticketAccent,
  projectsLegacy,
  packageJson,
] = await Promise.all([
  readFile(new URL("src/maono-design-tokens.css", ROOT), "utf8"),
  readFile(new URL("src/main.tsx", ROOT), "utf8"),
  readFile(new URL("src/pages/Admin/maono-admin-accent.css", ROOT), "utf8"),
  readFile(new URL("src/pages/maono-login-accent.css", ROOT), "utf8"),
  readFile(new URL("src/pages/Projects/maono-residual-accent.css", ROOT), "utf8"),
  readFile(new URL("src/pages/Projects/projects.css", ROOT), "utf8"),
  readFile(new URL("package.json", ROOT), "utf8"),
]);

test("bridges visuais carregam depois dos tokens globais", () => {
  const tokenImport = 'import "./maono-design-tokens.css";';
  const residualImports = [
    'import "./pages/Projects/maono-residual-accent.css";',
    'import "./pages/Admin/maono-admin-accent.css";',
    'import "./pages/maono-login-accent.css";',
  ];

  assert.ok(main.includes(tokenImport));
  for (const entry of residualImports) {
    assert.ok(main.includes(entry), `import ausente: ${entry}`);
    assert.ok(main.indexOf(tokenImport) < main.indexOf(entry));
  }
});

test("Admin deriva accent do design system e possui focus ring global", () => {
  assert.match(adminAccent, /--admin-gold:\s*var\(--maono-accent-strong\)/);
  assert.match(adminAccent, /--admin-gold-bright:\s*var\(--maono-accent-bright\)/);
  assert.match(adminAccent, /--maono-focus-ring/);
  assert.match(adminAccent, /--maono-accent-border-strong/);
  assert.match(adminAccent, /--maono-accent-glow/);

  assert.match(
    adminAccent,
    /\.admin-membership-state\.active[\s\S]*?--maono-semantic-success/,
  );
  assert.match(
    adminAccent,
    /\.admin-user-guidance:not\(\.warning\)[\s\S]*?--maono-semantic-info/,
  );
});

test("Login mantém aparência dourada consumindo apenas tokens de marca", () => {
  for (const token of [
    "--maono-accent",
    "--maono-accent-strong",
    "--maono-accent-bright",
    "--maono-accent-border",
    "--maono-accent-border-strong",
    "--maono-accent-glow",
    "--maono-focus-ring",
  ]) {
    assert.ok(loginAccent.includes(token), `token ausente no Login: ${token}`);
  }

  for (const legacy of ["#f2c766", "#d6a84f", "#8a6a2f", "#20c7b5", "#67e8dd", "#9af5eb"]) {
    assert.ok(
      !loginAccent.toLowerCase().includes(legacy),
      `hardcode de marca reintroduzido no bridge do Login: ${legacy}`,
    );
  }

  assert.match(loginAccent, /--maono-semantic-danger/);
});

test("Central de Chamados usa dourado para chrome residual", () => {
  for (const selector of [
    ".ticket-organization-chip",
    ".ticket-subject-button:hover",
    ".ticket-calendar-more",
    ".ticket-attachment-icon",
    ".ticket-history li > span",
    ".ticket-empty-state > span",
  ]) {
    assert.ok(ticketAccent.includes(selector), `selector residual ausente: ${selector}`);
  }

  assert.match(ticketAccent, /--maono-accent-bright/);
  assert.match(ticketAccent, /--maono-accent-border-strong/);
  assert.match(ticketAccent, /--maono-accent-surface/);
  assert.match(ticketAccent, /--maono-focus-ring/);

  for (const legacy of ["#20c7b5", "#67e8dd", "#9af5eb", "rgba(32, 199, 181"]) {
    assert.ok(
      !ticketAccent.toLowerCase().includes(legacy),
      `branding teal reintroduzido na camada residual: ${legacy}`,
    );
  }
});

test("estados funcionais permanecem semânticos e não viram dourado", () => {
  assert.match(
    ticketAccent,
    /\.ticket-metric-icon\.metric-progress[\s\S]*?--maono-semantic-info/,
  );
  assert.match(
    ticketAccent,
    /\.ticket-priority\.priority-low[\s\S]*?--maono-semantic-info/,
  );
  assert.match(
    ticketAccent,
    /\.ticket-metric-icon\.metric-closed[\s\S]*?--maono-semantic-success/,
  );
  assert.match(ticketAccent, /\.ticket-toast[\s\S]*?--maono-semantic-success/);
  assert.match(ticketAccent, /\.roadmap-task-bar[\s\S]*?--maono-semantic-info/);
  assert.match(
    ticketAccent,
    /\.roadmap-status:not\(\.status-completed\):not\(\.status-blocked\)[\s\S]*?--maono-semantic-info/,
  );
});

test("aliases históricos ficam neutralizados por bridge canônico de maior especificidade", () => {
  // Dívida física ainda existente no monólito; PR 6 impede que ela defina o runtime.
  assert.match(projectsLegacy, /--mm-teal:\s*#20c7b5/);

  assert.match(ticketAccent, /html:root\s*\{/);
  assert.match(ticketAccent, /--mm-teal:\s*var\(--maono-accent\)/);
  assert.match(ticketAccent, /--mm-gold:\s*var\(--maono-accent-strong\)/);
  assert.match(ticketAccent, /--mm-gold-bright:\s*var\(--maono-accent-bright\)/);
  assert.match(ticketAccent, /--mm-gold-muted:\s*var\(--maono-accent-muted\)/);
  assert.match(ticketAccent, /--mm-danger:\s*var\(--maono-semantic-danger\)/);
  assert.match(ticketAccent, /--mm-success:\s*var\(--maono-semantic-success\)/);
  assert.doesNotMatch(ticketAccent, /var\(--mm-teal\)/);

  assert.match(tokens, /--maono-accent-muted:\s*#8a6a2f/);
  assert.match(tokens, /--maono-semantic-success:/);
  assert.match(tokens, /--maono-semantic-info:/);
});

test("limites e Roadmap usam contrato global em vez da antiga paleta teal", () => {
  assert.match(
    ticketAccent,
    /\.projects-limit-progress > span[\s\S]*?--maono-accent-strong[\s\S]*?--maono-accent-bright/,
  );
  assert.match(ticketAccent, /\.roadmap-shell[\s\S]*?--maono-accent-strong/);
  assert.match(ticketAccent, /\.roadmap-milestone[\s\S]*?--maono-accent-bright/);
});

test("gates de accent participam do gate de Projects", () => {
  const pkg = JSON.parse(packageJson);
  assert.match(pkg.scripts["test:accent-residual"], /maono-residual-accent\.test\.mjs/);
  assert.match(pkg.scripts["test:projects"], /test:accent-residual/);
  assert.match(pkg.scripts["test:projects"], /test:accent-gate/);
});
