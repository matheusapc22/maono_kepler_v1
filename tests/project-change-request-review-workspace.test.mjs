import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  routes,
  provider,
  loader,
  page,
  reviewApi,
  reviewBaseClient,
  reviewProjection,
  reviewProjectionCore,
  reviewService,
  directDelivery,
  reviewEndpoint,
  applyEndpoint,
] = await Promise.all([
  readFile(new URL("../src/Routes.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../src/pages/Kepler/map-panel/MapPanelProvider.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/pages/Kepler/map-url-loader/index.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/change-requests/ChangeRequestReviewPage.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../src/pages/Kepler/change-requests/review-api.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/change-requests/review-base-config-client.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/change-requests/review-operation-projection.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/change-requests/review-operation-projection-core.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../functions/_lib/project-change-request-review.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../functions/_lib/project-config-revision-direct-delivery.js",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../functions/api/projects/[slug]/change-requests/[id]/review.js",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../functions/api/projects/[slug]/change-requests/[id]/apply.js",
      import.meta.url,
    ),
    "utf8",
  ),
]);

function functionBody(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `início não encontrado: ${start}`);
  assert.notEqual(to, -1, `fim não encontrado: ${end}`);
  return source.slice(from, to);
}

test("PR4: rota dedicada /projects/:slug/review/:changeRequestId usa workspace próprio", () => {
  assert.match(
    routes,
    /path="\/projects\/:projectSlug\/review\/:changeRequestId"/,
  );
  assert.match(routes, /ChangeRequestReviewPage/);
  assert.match(page, /<KeplerApp\s*\/>/);
  assert.match(page, /ReviewWorkspaceOverlay/);
});

test("PR4: Review exige contexto Editor mas remove capabilities de escrita do mapa", () => {
  assert.match(provider, /isReviewWorkspace\(pathname\).*return "editor"/s);
  assert.match(provider, /reviewReadOnlyContext/);
  for (const capability of [
    "placeAnalysisMarker",
    "createPoint",
    "previewIsochrone",
    "previewBuffer",
    "persistIsochrone",
    "persistBuffer",
    "editLayers",
    "editStyle",
    "createLayer",
    "addData",
    "importData",
    "removeLayer",
    "manageFilters",
    "editFilters",
    "saveMap",
    "createProject",
    "editMetadata",
    "updateThumbnail",
    "requestProjectChange",
  ]) {
    assert.match(
      provider,
      new RegExp(`${capability}:\\s*false`),
      `${capability} precisa permanecer bloqueada no Review`,
    );
  }
});

test("P0 large-map: Review hidrata a revisão-base direto do storage, não pelo payload /review", () => {
  assert.match(loader, /loadReviewBaseProjectConfig/);
  assert.match(loader, /materializeProjectChangeReviewProjections/);
  assert.doesNotMatch(loader, /review\.base\.config/);
  assert.match(reviewBaseClient, /credentials:\s*"omit"/);
  assert.match(reviewBaseClient, /cache:\s*"no-store"/);
  assert.match(reviewBaseClient, /referrerPolicy:\s*"no-referrer"/);
  assert.match(reviewBaseClient, /receivedBytes !== expectedSizeBytes/);
  assert.match(reviewBaseClient, /pinnedRevision/);
  assert.match(loader, /context\?\.mode === "viewer" \|\| Boolean\(changeRequestId\)/);
});

test("P0 large-map: contrato v2 não contém MapConfig e pina descriptor à baseRevision", () => {
  assert.match(reviewApi, /contractVersion:\s*2/);
  assert.match(reviewApi, /transport:\s*"direct"/);
  assert.doesNotMatch(reviewApi, /base:\s*\{[\s\S]{0,500}config:/);
  assert.match(reviewApi, /review\.base\.delivery\.revision/);
  assert.match(reviewApi, /review\.base\.revision/);
  assert.match(reviewApi, /CHANGE_REQUEST_REVIEW_CONTRACT_UNSUPPORTED/);
  assert.match(directDelivery, /assertMapConfigStorageRef/);
  assert.match(directDelivery, /ledger\.storage_provider_hash/);
  assert.match(directDelivery, /metadata\?\.content_hash/);
});

test("P0 large-map: GET/POST de Review são control plane e não materializam MapConfig", () => {
  const workspace = functionBody(
    reviewService,
    "async function buildWorkspace",
    "async function transitionStatus",
  );
  assert.match(workspace, /baseRevisionLedger/);
  assert.match(workspace, /createProjectConfigRevisionDirectDescriptor/);
  assert.match(workspace, /operations:\s*context\.operations/);
  assert.doesNotMatch(workspace, /readVerifiedBaseRevisionForApply/);
  assert.doesNotMatch(workspace, /buildProjectChangeProposal/);
  assert.doesNotMatch(workspace, /buildProjectConfigArtifact/);
  assert.doesNotMatch(workspace, /repository\.getRevision/);
  assert.doesNotMatch(workspace, /base\.config/);
  assert.match(reviewEndpoint, /Cache-Control/);
  assert.match(reviewEndpoint, /private, no-store/);
  assert.match(reviewEndpoint, /reviewPayloadBytes/);
  assert.doesNotMatch(reviewEndpoint, /downloadUrl:/);
});

test("P0 large-map: projeções Before/After são produzidas no navegador sem clone do MapConfig inteiro", () => {
  assert.match(reviewProjection, /buildReviewOperationProjections/);
  assert.match(reviewProjection, /buildCoreReviewOperationProjections/);
  assert.match(reviewProjection, /projectCoverageOperation/);
  assert.match(reviewProjectionCore, /baseLayers\(baseConfig\)/);
  assert.match(reviewProjectionCore, /projectStyle/);
  assert.match(reviewProjectionCore, /newPointStyle/);
  assert.match(reviewProjectionCore, /newAnalysisStyle/);
  assert.match(reviewProjectionCore, /layer\.style = clone\(after\)/);
  assert.doesNotMatch(reviewProjection, /clone\(baseConfig\)/);
  assert.doesNotMatch(reviewProjectionCore, /clone\(baseConfig\)/);
  assert.match(reviewApi, /projectionCache/);
  assert.match(reviewApi, /cacheProjectChangeReviewProjection/);
});

test("PR4: workspace preserva before/after, navegação e três decisões", () => {
  assert.match(page, />\s*Antes\s*</);
  assert.match(page, />\s*Depois\s*</);
  assert.match(page, /Operação \$\{selectedIndex \+ 1\} de \$\{operations\.length\}/);
  assert.match(page, />\s*Rejeitar\s*</);
  assert.match(page, />\s*Aprovar\s*</);
  assert.match(page, /Aprovar e aplicar/);
  assert.match(page, /ReviewMarkerLayer/);
  assert.match(page, /markerOriginToScreen/);
});

test("PR4: Reviewer boundary é separado do GET requester-only e endpoints têm métodos explícitos", () => {
  assert.match(reviewService, /requireReviewerProject/);
  assert.match(reviewService, /"project\.map\.edit"/);
  assert.match(reviewService, /PROJECT_MAP_ROUTE_MODES\.EDITOR/);
  assert.match(reviewService, /"project\.save"/);
  assert.match(reviewEndpoint, /Allow:\s*"GET, POST"/);
  assert.match(applyEndpoint, /request\.method !== "POST"/);
  assert.match(applyEndpoint, /Allow:\s*"POST"/);
});

test("PR4: Apply continua autoritativo e publica base+1 pelo save versionado", () => {
  assert.match(reviewService, /readVerifiedBaseRevisionForApply/);
  assert.match(reviewService, /buildProjectChangeProposal/);
  assert.match(reviewService, /saveVersionedProjectConfig\(env/);
  assert.match(reviewService, /expectedConfigRevision:\s*baseRevision/);
  assert.doesNotMatch(reviewService, /createProjectRecord/);
  assert.doesNotMatch(reviewService, /createProjectLifecycle/);
  assert.match(
    reviewService,
    /projectIdentity:\s*\{[\s\S]*id:\s*context\.project\.id,[\s\S]*slug:\s*context\.project\.slug/,
  );
});

test("PR4: conflito e retry idempotente protegem o HEAD", () => {
  assert.match(reviewService, /CHANGE_REQUEST_REVIEW_CONFLICT/);
  assert.match(
    reviewService,
    /context\.row\.status === "applying" && currentRevision === baseRevision \+ 1/,
  );
  assert.match(reviewService, /Mantém `applying`/);
  assert.match(reviewService, /CHANGE_REQUEST_APPLY_COMMIT_NOT_CONFIRMED/);
  assert.match(reviewService, /if \(row\.status === "applied"\) return null/);
});
