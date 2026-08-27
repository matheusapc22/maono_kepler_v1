import assert from "node:assert/strict";
import test from "node:test";

import {
  PREVIEW_WRITE_REASONS,
  evaluatePreviewWritePolicy,
} from "../functions/_lib/preview-write-policy.js";
import {
  RUNTIME_ENVIRONMENTS,
  publicRuntimeDiagnostics,
  resolveRuntimeEnvironment,
} from "../functions/_lib/runtime-environment.js";

function previewEnv(overrides = {}) {
  return {
    MAONO_RUNTIME_ENV: "preview",
    MAONO_PREVIEW_MUTATIONS_ENABLED: "true",
    MAONO_PREVIEW_QA_ORG_ID: "9001",
    ...overrides,
  };
}

test("runtime diferencia production, preview e configuração ausente", () => {
  assert.equal(
    resolveRuntimeEnvironment({ MAONO_RUNTIME_ENV: "production" }),
    RUNTIME_ENVIRONMENTS.PRODUCTION,
  );
  assert.equal(
    resolveRuntimeEnvironment({ MAONO_RUNTIME_ENV: "preview" }),
    RUNTIME_ENVIRONMENTS.PREVIEW,
  );
  assert.equal(
    resolveRuntimeEnvironment({}),
    RUNTIME_ENVIRONMENTS.UNKNOWN,
  );

  assert.deepEqual(publicRuntimeDiagnostics(previewEnv()), {
    runtime: "preview",
    preview: true,
    previewMutationsEnabled: true,
    previewQaOrganizationConfigured: true,
  });
});

test("production não sofre restrição da política de preview", () => {
  const decision = evaluatePreviewWritePolicy(
    { MAONO_RUNTIME_ENV: "production" },
    {
      method: "DELETE",
      pathname: "/api/admin/users/1",
      organizationId: "123",
    },
  );

  assert.deepEqual(decision, {
    allowed: true,
    reason: PREVIEW_WRITE_REASONS.NOT_PREVIEW,
  });
});

test("preview permite leitura real do banco de produção", () => {
  const decision = evaluatePreviewWritePolicy(previewEnv(), {
    method: "GET",
    pathname: "/api/projects/demo",
    organizationId: "123",
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, PREVIEW_WRITE_REASONS.READ_ONLY_REQUEST);
});

test("kill switch bloqueia mutações de domínio no preview", () => {
  const decision = evaluatePreviewWritePolicy(
    previewEnv({ MAONO_PREVIEW_MUTATIONS_ENABLED: "false" }),
    {
      method: "PUT",
      pathname: "/api/projects/qa-geojson-golden/config",
      organizationId: "9001",
    },
  );

  assert.equal(decision.allowed, false);
  assert.equal(
    decision.reason,
    PREVIEW_WRITE_REASONS.PREVIEW_MUTATIONS_DISABLED,
  );
});

test("autenticação e sessão continuam operacionais no preview", () => {
  for (const pathname of [
    "/api/auth/login",
    "/api/session",
    "/api/session/active-organization",
  ]) {
    const decision = evaluatePreviewWritePolicy(previewEnv(), {
      method: "POST",
      pathname,
    });
    assert.equal(decision.allowed, true, pathname);
    assert.equal(
      decision.reason,
      PREVIEW_WRITE_REASONS.PREVIEW_RUNTIME_MUTATION_ALLOWED,
      pathname,
    );
  }
});

test("preview permite escrita de projeto somente na organização QA", () => {
  const qa = evaluatePreviewWritePolicy(previewEnv(), {
    method: "PUT",
    pathname: "/api/projects/qa-geojson-golden/config",
    organizationId: "9001",
  });
  const productionOrg = evaluatePreviewWritePolicy(previewEnv(), {
    method: "PUT",
    pathname: "/api/projects/projeto-real/config",
    organizationId: "42",
  });

  assert.equal(qa.allowed, true);
  assert.equal(qa.reason, PREVIEW_WRITE_REASONS.PREVIEW_QA_WRITE_ALLOWED);
  assert.equal(productionOrg.allowed, false);
  assert.equal(
    productionOrg.reason,
    PREVIEW_WRITE_REASONS.PREVIEW_WRITE_OUTSIDE_QA_ORG,
  );
});

test("preview bloqueia mutações administrativas e de storage mesmo na organização QA", () => {
  for (const pathname of [
    "/api/admin/users/1",
    "/api/organizations/9001",
    "/api/dropbox/upload",
    "/api/tickets/123",
  ]) {
    const decision = evaluatePreviewWritePolicy(previewEnv(), {
      method: "POST",
      pathname,
      organizationId: "9001",
    });

    assert.equal(decision.allowed, false, pathname);
    assert.equal(
      decision.reason,
      PREVIEW_WRITE_REASONS.PREVIEW_GLOBAL_MUTATION_DENIED,
      pathname,
    );
  }
});

test("preview falha fechado quando não consegue resolver a organização QA", () => {
  const decision = evaluatePreviewWritePolicy(previewEnv(), {
    method: "POST",
    pathname: "/api/projects",
    organizationId: null,
  });

  assert.equal(decision.allowed, false);
  assert.equal(
    decision.reason,
    PREVIEW_WRITE_REASONS.PREVIEW_MUTATION_SCOPE_UNRESOLVED,
  );
});
