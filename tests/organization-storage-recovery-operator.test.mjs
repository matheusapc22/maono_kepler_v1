import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  renderRecoveryWranglerConfig,
  writeRecoveryWranglerConfig,
  RECOVERY_PRODUCTION_DATABASE_ID,
} from "../scripts/organization-storage/render-recovery-wrangler-config.mjs";
import { verifyRecoveryD1Evidence } from "../scripts/organization-storage/verify-recovery-d1-evidence.mjs";

const DB_ID = RECOVERY_PRODUCTION_DATABASE_ID;
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

test("config disabled nasce sem recovery mutável", () => {
  const config = renderRecoveryWranglerConfig({
    mode: "disabled",
    databaseId: DB_ID,
  });

  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_ENABLED = "false"/,
  );
  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_DRY_RUN = "true"/,
  );
  assert.match(config, new RegExp(DB_ID));
  assert.match(config, /MAONO_STORAGE_RECOVERY_KILL_SWITCH = "true"/);
  assert.match(config, /crons = \["\*\/15 \* \* \* \*"\]/);
});

test("config dry-run habilita worker sem apply", () => {
  const config = renderRecoveryWranglerConfig({
    mode: "dry-run",
    databaseId: DB_ID,
  });

  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_ENABLED = "true"/,
  );
  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_DRY_RUN = "true"/,
  );
});

test("config apply exige modo explícito e mantém kill switch falso", () => {
  const config = renderRecoveryWranglerConfig({
    mode: "apply",
    databaseId: DB_ID,
    batchSize: 5,
    errorBackoffSeconds: 1200,
  });

  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_ENABLED = "true"/,
  );
  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_DRY_RUN = "false"/,
  );
  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_KILL_SWITCH = "false"/,
  );
  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_BATCH_SIZE = "5"/,
  );
  assert.match(
    config,
    /MAONO_STORAGE_RECOVERY_ERROR_BACKOFF_SECONDS = "1200"/,
  );
});

test("renderer rejeita D1 id e modo inválidos", () => {
  assert.throws(
    () => renderRecoveryWranglerConfig({ mode: "disabled", databaseId: "123e4567-e89b-42d3-a456-426614174000" }),
    /Production maono_maps/,
  );

  assert.throws(
    () =>
      renderRecoveryWranglerConfig({
        mode: "apply",
        databaseId: "not-a-d1-id",
      }),
    /D1_DATABASE_ID/,
  );

  assert.throws(
    () =>
      renderRecoveryWranglerConfig({
        mode: "unknown",
        databaseId: DB_ID,
      }),
    /disabled, dry-run ou apply/,
  );
});

test("config em diretório aninhado resolve Worker e migrations reais, inclusive com espaços", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "maono operator "));
  try {
    const outputPath = path.join(temporaryRoot, "nested dir", "recovery.toml");
    const written = await writeRecoveryWranglerConfig({ mode: "disabled", databaseId: DB_ID, outputPath });
    const config = await readFile(written, "utf8");
    for (const [key, expected] of [["main", "workers/organization-storage-recovery.js"], ["migrations_dir", "migrations"]]) {
      const raw = config.match(new RegExp(`^${key} = (.+)$`, "m"))?.[1];
      const resolved = path.resolve(path.dirname(outputPath), JSON.parse(raw));
      assert.equal(resolved, path.join(repositoryRoot, expected));
      await access(resolved);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("renderer rejeita limites inválidos sem gerar NaN nem normalizar silenciosamente", () => {
  for (const [key, values] of Object.entries({
    batchSize: [0, 51, 1.5, "", "1e1", Infinity, NaN],
    errorBackoffSeconds: [0, 59, 86401, "bad"],
    claimTtlSeconds: [0, 29, 1801, "120\"\n[triggers]"],
  })) {
    for (const value of values) {
      assert.throws(() => renderRecoveryWranglerConfig({ mode: "apply", databaseId: DB_ID, [key]: value }), /inteiro entre/);
    }
  }
  const config = renderRecoveryWranglerConfig({ mode: "apply", databaseId: DB_ID, batchSize: "50", errorBackoffSeconds: 86400, claimTtlSeconds: 1800 });
  assert.match(config, /BATCH_SIZE = "50"/);
});

test("cron limita campos e impede injeção de configuração", () => {
  for (const cron of ["* * * *", "60 * * * *", "*/0 * * * *", "0 24 * * *", "0 0 0 * *", "0 0 * 13 *", "0 0 * * 7", "0 0 * * 5-2", '* * * * *\"]\n[vars]', "@hourly"]) {
    assert.throws(() => renderRecoveryWranglerConfig({ mode: "dry-run", databaseId: DB_ID, cron }));
  }
  assert.match(renderRecoveryWranglerConfig({ mode: "dry-run", databaseId: DB_ID, cron: "0,30 8-18/2 * * 1-5" }), /0,30 8-18\/2 \* \* 1-5/);
});

test("config inválida não sobrescreve o último arquivo validado", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "maono-config-"));
  const outputPath = path.join(directory, "recovery.toml");
  try {
    await writeRecoveryWranglerConfig({ mode: "disabled", databaseId: DB_ID, outputPath });
    const previous = await readFile(outputPath, "utf8");
    await assert.rejects(writeRecoveryWranglerConfig({ mode: "apply", databaseId: DB_ID, outputPath, batchSize: 0 }));
    assert.equal(await readFile(outputPath, "utf8"), previous);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function workflowRunBlock(source, stepName) {
  const section = source.split(`- name: ${stepName}\n`)[1]?.split("\n      - name:")[0];
  assert.ok(section, `Missing workflow step ${stepName}`);
  const lines = section.split("run: |\n")[1].split("\n");
  const end = lines.findIndex((line) => line.trim() && !line.startsWith("          "));
  return (end < 0 ? lines : lines.slice(0, end)).map((line) => line.replace(/^          /, "")).join("\n");
}

test("confirmação executável bloqueia modo mutável sem migration ou ref de produto", { skip: process.platform === "win32" ? "Workflow Bash executa no runner Ubuntu" : false }, async () => {
  const source = await readFile(new URL("../.github/workflows/organization-storage-recovery-operator.yml", import.meta.url), "utf8");
  const script = workflowRunBlock(source, "Validate explicit operator confirmation");
  const invoke = (env) => spawnSync("bash", ["--noprofile", "--norc", "-c", script], { encoding: "utf8", timeout: 5000, env: { ...process.env, BASH_ENV: "/dev/null", RELEASE_REF: "mano_kepler_v1", ...env } });
  assert.equal(invoke({ MODE: "validate", CONFIRMATION: "VALIDATE_STORAGE_RECOVERY_OPERATOR", MIGRATION_CONFIRMATION: "" }).status, 0);
  assert.notEqual(invoke({ MODE: "deploy_apply", CONFIRMATION: "DEPLOY_STORAGE_RECOVERY_APPLY", MIGRATION_CONFIRMATION: "" }).status, 0);
  assert.notEqual(invoke({ MODE: "deploy_apply", CONFIRMATION: "DEPLOY_STORAGE_RECOVERY_APPLY", MIGRATION_CONFIRMATION: "MIGRATION_0009_APPLIED_TO_TARGET_D1", RELEASE_REF: "unreviewed-feature" }).status, 0);
  assert.equal(invoke({ MODE: "deploy_apply", CONFIRMATION: "DEPLOY_STORAGE_RECOVERY_APPLY", MIGRATION_CONFIRMATION: "MIGRATION_0009_APPLIED_TO_TARGET_D1" }).status, 0);
  assert.notEqual(invoke({ MODE: "unknown", CONFIRMATION: "", MIGRATION_CONFIRMATION: "" }).status, 0);
});

test("resumo Bash escreve SHA e modo literalmente sem executá-los", { skip: process.platform === "win32" ? "Workflow Bash executa no runner Ubuntu" : false }, async () => {
  const source = await readFile(new URL("../.github/workflows/organization-storage-recovery-operator.yml", import.meta.url), "utf8");
  const directory = await mkdtemp(path.join(tmpdir(), "maono-summary-"));
  try {
    const outputPath = path.join(directory, "summary.md");
    const result = spawnSync("bash", ["--noprofile", "--norc", "-euo", "pipefail", "-c", workflowRunBlock(source, "Record operator result")], {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, BASH_ENV: "/dev/null", MODE: "deploy_dry_run", VALIDATED_RELEASE_SHA: "0123456789abcdef", GITHUB_STEP_SUMMARY: outputPath },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const summary = await readFile(outputPath, "utf8");
    assert.match(summary, /`0123456789abcdef`/);
    assert.match(summary, /`deploy_dry_run`/);
    assert.match(summary, /`maono-organization-storage-recovery`/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function migrationEvidence() {
  return {
    databaseInfo: { name: "maono_maps", uuid: DB_ID },
    recoveryInfo: { bookmark: "00000000-00000000-00000000-00000000" },
    queryResults: [
      [{ name: "0009_organization_storage_invariant.sql", applied_at: "2026-09-01 20:28:42" }],
      ["storage_status", "storage_error", "storage_checked_at"].map((name) => ({ name, type: "TEXT", notnull: 0, dflt_value: null })),
      [{ name: "idx_organizations_storage_status", unique: 0, partial: 0 }],
      [{ seqno: 0, name: "storage_status" }],
    ].map((results) => ({ success: true, results })),
  };
}

test("evidência remota exige identidade, histórico e schema concordantes", () => {
  const valid = migrationEvidence();
  assert.equal(verifyRecoveryD1Evidence(valid).prerequisiteVerified, true);
  const variants = [
    (input) => { input.databaseInfo.uuid = "123e4567-e89b-42d3-a456-426614174000"; },
    (input) => { input.databaseInfo.name = "maono_maps_preview_r0"; },
    (input) => { input.queryResults.pop(); },
    (input) => { input.queryResults[0].results = []; },
    (input) => { input.queryResults[0].results.push({ ...input.queryResults[0].results[0] }); },
    (input) => { input.queryResults[1].results.pop(); },
    (input) => { input.queryResults[1].results[0].type = "INTEGER"; },
    (input) => { input.queryResults[1].results[0].notnull = 1; },
    (input) => { input.queryResults[2].results[0].partial = 1; },
    (input) => { input.queryResults[3].results[0].name = "storage_error"; },
    (input) => { input.queryResults[3].success = false; },
    (input) => { input.recoveryInfo = null; },
    (input) => { input.recoveryInfo.bookmark = ""; },
  ];
  for (const mutate of variants) {
    const invalid = migrationEvidence();
    mutate(invalid);
    assert.throws(() => verifyRecoveryD1Evidence(invalid));
  }
});
