import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const urls = {
  routes: new URL("../src/Routes.tsx", import.meta.url),
  management: new URL(
    "../src/pages/Kepler/map-panel/MapManagementPage.tsx",
    import.meta.url,
  ),
  endpoint: new URL(
    "../functions/api/projects/[slug]/map-navigation.js",
    import.meta.url,
  ),
  canonicalService: new URL(
    "../functions/_lib/project-map-navigation-service.js",
    import.meta.url,
  ),
  legacyService: new URL(
    "../functions/_lib/map-panel-service.js",
    import.meta.url,
  ),
};

const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(urls).map(async ([key, url]) => [key, await readFile(url, "utf8")]),
  ),
);

test("novo projeto permanece exclusivo de /maps/new/create", () => {
  assert.match(
    sources.routes,
    /path="\/maps\/new\/create"[\s\S]*?<KeplerApp\s*\/?>/,
  );
  assert.match(
    sources.legacyService,
    /mode:\s*MAP_PANEL_MODES\.CREATE[\s\S]*route:\s*preflight\.allowed\s*\?\s*"\/maps\/new\/create"/,
  );
});

test("rota create de projeto existente é apenas redirect temporário", () => {
  assert.match(
    sources.routes,
    /path="\/projects\/:projectSlug\/create"[\s\S]*element=\{<DeprecatedProjectCreateRedirect\s*\/>\}/,
  );
  assert.match(
    sources.routes,
    /DeprecatedProjectCreateRedirect[\s\S]*\/projects\/\$\{encodeURIComponent\(projectSlug\)\}\/manage/,
  );

  const createRouteStart = sources.routes.indexOf(
    'path="/projects/:projectSlug/create"',
  );
  const nextRouteStart = sources.routes.indexOf("<Route", createRouteStart + 10);
  const createRouteBlock = sources.routes.slice(createRouteStart, nextRouteStart);
  assert.doesNotMatch(createRouteBlock, /KeplerApp/);
});

test("manage de projeto existente prioriza editor e depois viewer", () => {
  assert.match(
    sources.management,
    /context\.availablePanels\.editor\.allowed[\s\S]*\?\s*"edit"[\s\S]*context\.availablePanels\.viewer\.allowed[\s\S]*\?\s*"view"/,
  );
  assert.doesNotMatch(sources.management, /availablePanels\.create\.allowed/);
});

test("endpoint usa somente o contrato canônico de projeto existente", () => {
  assert.match(
    sources.endpoint,
    /resolveCanonicalExistingProjectMapNavigation/,
  );
  assert.doesNotMatch(
    sources.endpoint,
    /resolveExistingProjectMapNavigation\s*from/,
  );
});

test("contrato canônico não consulta project.create para projeto existente", () => {
  assert.doesNotMatch(
    sources.canonicalService,
    /can\(env, user, "project\.create"/,
  );
  assert.match(
    sources.canonicalService,
    /create:\s*\{[\s\S]*allowed:\s*false,[\s\S]*route:\s*null,[\s\S]*PROJECT_CREATE_ROUTE_DEPRECATED/,
  );
});

test("modo create explícito de projeto existente é Gone e aponta para manage", () => {
  assert.match(
    sources.canonicalService,
    /requestedMode === MAP_PANEL_MODES\.CREATE[\s\S]*status:\s*410/,
  );
  assert.match(
    sources.canonicalService,
    /replacementRoute:[\s\S]*\/projects\/\$\{encodeURIComponent\(project\.slug\)\}\/manage/,
  );
});

test("projeto existente nunca recebe capacidades exclusivas de criação", () => {
  assert.match(
    sources.canonicalService,
    /openCreateWorkspaceAllowed:\s*false/,
  );
  assert.match(sources.canonicalService, /createProjectAllowed:\s*false/);
  assert.match(sources.canonicalService, /initializeMapAllowed:\s*false/);
});

test("policy v3 formaliza a separação entre projeto existente e criação", () => {
  assert.match(
    sources.canonicalService,
    /EXISTING_PROJECT_NAVIGATION_POLICY_VERSION = 3/,
  );
  assert.match(
    sources.canonicalService,
    /defaultExistingProjectPanel[\s\S]*editorAllowed[\s\S]*MAP_PANEL_MODES\.EDITOR[\s\S]*viewerAllowed[\s\S]*MAP_PANEL_MODES\.VIEWER/,
  );
});
