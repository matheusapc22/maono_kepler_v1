import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  routes,
  provider,
  loader,
  page,
  reviewApi,
  reviewService,
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
    new URL("../functions/_lib/project-change-request-review.js", import.meta.url),
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

test("PR4: mapa do Review hidrata a revisão-base, não o HEAD atual", () => {
  assert.match(loader, /getProjectChangeReview/);
  assert.match(loader, /review\.base\.config/);
  assert.match(loader, /revision:\s*review\.base\.revision/);
  assert.match(loader, /context\?\.mode === "viewer" \|\| Boolean\(changeRequestId\)/);
  assert.match(reviewApi, /reviewCache/);
});

test("PR4: workspace entrega before\/after, navegação e três decisões", () => {
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

test("PR4: Apply publica base+1 pelo save versionado sem fluxo de criação", () => {
  assert.match(reviewService, /saveVersionedProjectConfig\(env/);
  assert.match(reviewService, /expectedConfigRevision:\s*baseRevision/);
  assert.doesNotMatch(reviewService, /createProjectRecord/);
  assert.doesNotMatch(reviewService, /createProjectLifecycle/);
  assert.match(reviewService, /projectIdentity:\s*\{[\s\S]*id:\s*context\.project\.id,[\s\S]*slug:\s*context\.project\.slug/);
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
