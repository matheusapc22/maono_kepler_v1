import { createExecutionBudget } from "./execution-budget.mjs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  activeFlags,
  assertProduction,
  buildProfiles,
  initialReport,
  parseArgs,
  parseCredentials,
  readProduction,
  safeError,
  safeFlags,
  suiteContext,
  transitionFlags,
  writeReport,
} from "./production-acceptance-lib.mjs";
import { getSuite, publicManifest } from "./registry.mjs";

function flagsMatch(project, values) {
  return Object.entries(values).every(([name, value]) =>
    project.configuredFlags[name]?.state === "observed" &&
    project.canonical.flags[name]?.state === "observed" &&
    project.configuredFlags[name].value === value &&
    project.canonical.flags[name].value === value
  );
}

function publicProject(project) {
  return {
    name: project.name,
    productionBranch: project.productionBranch,
    baseUrl: project.baseUrl,
    databaseId: project.databaseId,
    configuredFlags: project.configuredFlags,
    canonical: project.canonical,
    pendingProductionDeployments: (project.pendingProductionDeployments || []).map((deployment) => ({
      id: deployment.id,
      stage: deployment.stage,
      status: deployment.status,
      commit: deployment.commit,
    })),
  };
}

async function main(argv = process.argv.slice(2), env = process.env, runtime = {}) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.mode === "describe") {
      process.stdout.write(`${JSON.stringify(publicManifest(options.suite), null, 2)}\n`);
      return 0;
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: safeError(error) }, null, 2)}\n`);
    return 1;
  }

  const suite = getSuite(options.suite);
  const manifest = suite.manifest;
  const budget = createExecutionBudget(manifest, { now: runtime.now || Date.now });
  const deps = { ...runtime, budget };
  const report = initialReport({
    mode: options.mode,
    suite: manifest.id,
    suiteVersion: manifest.version,
    organizationId: options.organizationId,
    projectSlug: options.projectSlug,
    expectedCommit: options.expectedCommit,
  });
  let context = null;
  let initialProject = null;
  let operationError = null;
  let cleanupErrors = [];

  try {
    budget.enter("preflight");
    const token = String(env.MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN || "");
    initialProject = await readProduction(token, manifest, deps);
    report.preflight = publicProject(initialProject);

    if (options.mode === "preflight") {
      assertProduction(initialProject, options.expectedCommit, manifest, { requireBaseline: true });
      if (suite.verifyPreflight) suite.verifyPreflight(initialProject, options);
      report.ok = true;
      report.complete = true;
      report.acceptanceExecuted = false;
      report.writesPerformed = false;
      report.configurationRestored = true;
      report.cleanupComplete = true;
      return 0;
    }

    if (options.mode === "closure") {
      assertProduction(initialProject, options.expectedCommit, manifest, { requireBaseline: false });
      if (initialProject.name !== "maono-kepler-v1" ||
          initialProject.productionBranch !== "mano_kepler_v1" ||
          initialProject.databaseId !== "5bc4dc32-f3bd-4c92-bbd1-cbda63e467db" ||
          !initialProject.canonical.id ||
          initialProject.canonical.environment !== "production" ||
          initialProject.canonical.stage !== "deploy" ||
          initialProject.canonical.status !== "success" ||
          !initialProject.canonical.commit) {
        throw new Error("Estado canônico insuficiente para closure segura.");
      }
      budget.enter("restoration");
      const desired = safeFlags(manifest);
      if (!flagsMatch(initialProject, desired)) {
        const restored = await transitionFlags({
          token,
          sourceDeploymentId: initialProject.canonical.id,
          commit: initialProject.canonical.commit,
          manifest,
          deps,
          values: desired,
          onMutationStart: () => { report.writesPerformed = true; },
        });
        report.restoredDeployment = restored.deployment;
        report.final = publicProject(restored.project);
      } else {
        report.final = publicProject(initialProject);
      }
      report.configurationRestored = true;
      // A separate process has no resource inventory from an interrupted run.
      // Restoring flags cannot prove that synthetic resources were cleaned up.
      report.cleanupComplete = manifest.mutationMode === "read_only";
      report.ok = report.cleanupComplete;
      report.complete = report.cleanupComplete;
      if (!report.cleanupComplete) report.error = { code: "RESOURCE_CLEANUP_UNVERIFIED", message: "Flags restauradas; conferir recursos sintéticos do run interrompido antes de outra janela." };
      return report.complete ? 0 : 1;
    }

    assertProduction(initialProject, options.expectedCommit, manifest, { requireBaseline: true });
    if (suite.verifyPreflight) suite.verifyPreflight(initialProject, options);
    const credentialProfiles = parseCredentials(
      env.MAONO_ACCEPTANCE_QA_CREDENTIALS_JSON,
      manifest.requiredProfiles,
    );
    const profiles = await buildProfiles(
      initialProject.baseUrl,
      credentialProfiles,
      manifest,
      options.organizationId,
      deps,
    );
    report.qa = Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [
      name,
      {
        userId: profile.user.id,
        role: profile.user.role,
        permissionsChecked: manifest.requiredPermissions?.[name] || [],
      },
    ]));

    context = suiteContext({
      baseUrl: initialProject.baseUrl,
      organizationId: options.organizationId,
      projectSlug: options.projectSlug,
      profiles,
      mutationMode: manifest.mutationMode,
      deps,
    });

    // Keep the run identity in the terminal report and a pre-mutation checkpoint.
    report.runId = context.runId;

    // Registered read-only preparation must finish before a flag window opens.
    if (suite.prepare) await suite.prepare(context);
    const checkpoint = {
      event: "ACCEPTANCE_RUN_PREPARED", runId: context.runId,
      suite: manifest.id, organizationId: options.organizationId,
      expectedCommit: options.expectedCommit, safeFlags: safeFlags(manifest),
      cleanupContract: manifest.cleanup || null,
      executionDeadline: new Date(budget.endAt).toISOString(),
      message: "Prepared only; interrupted runs require independent closure and resource verification.",
    };
    await writeReport(`${options.reportPath}.checkpoint.json`, checkpoint, deps);
    process.stdout.write(`${JSON.stringify(checkpoint)}\n`);

    let restorationRequired = false;
    const hasManagedFlags = Object.keys(manifest.managedFlags).length > 0;
    try {
      if (hasManagedFlags) {
        budget.enter("activation");
        const activated = await transitionFlags({
          token,
          sourceDeploymentId: initialProject.canonical.id,
          commit: options.expectedCommit,
          manifest,
          deps,
          values: activeFlags(manifest),
          validateCurrent: (current) => { if (suite.verifyPreflight) suite.verifyPreflight(current, options); },
          onMutationStart: () => {
            budget.assertAdmission();
            restorationRequired = true;
            report.writesPerformed = true;
          },
        });
        report.activation = {
          deployment: activated.deployment,
          flags: activated.project.canonical.flags,
        };
      } else {
        report.activation = { skipped: true, reason: "SUITE_HAS_NO_MANAGED_FLAGS" };
      }

      budget.enter("suite");
      budget.assertAdmission();
      report.acceptanceExecuted = true;
      if (manifest.mutationMode === "controlled_mutation") report.writesPerformed = true;
      report.resources = await suite.run(context);
      report.cases = context.cases;
    } catch (error) {
      operationError = error;
      report.cases = context.cases;
    } finally {
      try {
        budget.enter("cleanup");
        cleanupErrors = await context.cleanup();
      } catch (cleanupError) {
        cleanupErrors = [safeError(cleanupError)];
      }
      report.cleanupErrors = cleanupErrors;
      report.cleanupComplete = cleanupErrors.length === 0;

      if (restorationRequired) {
        try {
          budget.enter("restoration");
          const restored = await transitionFlags({
            token,
            sourceDeploymentId: initialProject.canonical.id,
            commit: options.expectedCommit,
            manifest,
            deps,
            values: safeFlags(manifest),
          });
          report.restoredDeployment = restored.deployment;
          report.final = publicProject(restored.project);
          report.configurationRestored = true;
        } catch (restoreError) {
          report.configurationRestored = false;
          report.restoreError = safeError(restoreError);
          if (!operationError) operationError = restoreError;
        }
      } else {
        report.configurationRestored = true;
      }
    }

    const requiredCases = new Set(manifest.cases);
    const passed = new Set(report.cases.filter((item) => item.status === "PASS").map((item) => item.id));
    const allCasesPassed = [...requiredCases].every((id) => passed.has(id));
    if (operationError) throw operationError;
    if (cleanupErrors.length) throw new Error("Cleanup da suite ficou incompleto.");
    if (!allCasesPassed) throw new Error("Nem todos os casos obrigatórios terminaram em PASS.");
    if (report.configurationRestored !== true) throw new Error("Configuração de Produção não foi restaurada.");

    report.ok = true;
    report.complete = true;
    return 0;
  } catch (error) {
    report.error = safeError(error);
    report.ok = false;
    report.complete = false;
    if (context) report.cases = context.cases;
    return 1;
  } finally {
    // Hard termination can still bypass finally; checkpoint/logs identify the
    // run for the separately authorized closure workflow.
    let reportFailed = false;
    try { budget.enter("report"); } catch (error) {
      report.budgetError = safeError(error);
      report.ok = false; report.complete = false; reportFailed = true;
    }
    report.finishedAt = new Date().toISOString();
    try {
      await writeReport(options.reportPath, report, deps);
    } catch (writeError) {
      process.stderr.write(`${JSON.stringify({ ok: false, error: safeError(writeError), report }, null, 2)}\n`);
      reportFailed = true;
    }
    const summary = {
      ok: report.ok,
      complete: report.complete,
      mode: report.mode,
      suite: report.suite,
      expectedCommit: report.expectedCommit,
      acceptanceExecuted: report.acceptanceExecuted,
      configurationRestored: report.configurationRestored,
      cleanupComplete: report.cleanupComplete,
      cases: report.cases,
      error: report.error || null,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (reportFailed) return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}

export { main };
