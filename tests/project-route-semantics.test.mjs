import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { can } from "../functions/_lib/permissions.js";

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
  newMapContext: new URL(
    "../functions/api/maps/new/context.js",
    import.meta.url,
  ),
  canonicalService: new URL(
    "../functions/_lib/project-map-navigation-service.js",
    import.meta.url,
  ),
  routePolicy: new URL(
    "../functions/_lib/project-map-route-policy.js",
    import.meta.url,
  ),
  projectMiddleware: new URL(
    "../functions/api/projects/[slug]/_middleware.js",
    import.meta.url,
  ),
  mapAccessEndpoint: new URL(
    "../functions/api/organizations/[id]/users/[userId]/map-access.js",
    import.meta.url,
  ),
  usersAccess: new URL(
    "../src/pages/Projects/components/UsersAccessOverviewSection.tsx",
    import.meta.url,
  ),
  mapAccessManager: new URL(
    "../src/components/access/ProjectMapAccessManager.tsx",
    import.meta.url,
  ),
  legacyService: new URL(
    "../functions/_lib/map-panel-service.js",
    import.meta.url,
  ),
  permissions: new URL(
    "../functions/_lib/permissions.js",
    import.meta.url,
  ),
  largeCreate: new URL(
    "../functions/_lib/project-large-creation.js",
    import.meta.url,
  ),
  inlineCreate: new URL(
    "../functions/_lib/project-creation-lifecycle-service.js",
    import.meta.url,
  ),
};

const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(urls).map(async ([key, url]) => [key, await readFile(url, "utf8")]),
  ),
);

function makePermissionEnv({ accessLevel = "owner", deniedPermission = null } = {}) {
  const rowsFor = (sql, params) => {
    if (sql.includes("FROM user_permission_denials")) {
      const permission = params?.[2];
      return deniedPermission === permission ? [{ id: 1 }] : [];
    }

    if (sql.includes("FROM user_permissions")) {
      return [];
    }

    if (sql.includes("FROM role_permissions")) {
      return [];
    }

    if (sql.includes("FROM organization_users")) {
      return [{
        organization_id: 9,
        user_id: 77,
        access_level: "editor",
        role: null,
        active: 1,
      }];
    }

    if (sql.includes("FROM user_projects")) {
      return accessLevel
        ? [{ user_id: 77, project_id: 404, access_level: accessLevel }]
        : [];
    }

    return [];
  };

  return {
    DB: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              async all() {
                return { results: rowsFor(sql, params) };
              },
              async run() {
                return { success: true, meta: { changes: 0 } };
              },
            };
          },
          async all() {
            return { results: rowsFor(sql, []) };
          },
          async run() {
            return { success: true, meta: { changes: 0 } };
          },
        };
      },
    },
  };
}

const projectContext = {
  scopeType: "project",
  projectId: 404,
  projectSlug: "teste-4",
  organizationId: 9,
  project: {
    id: 404,
    slug: "teste-4",
    name: "Teste 4",
    organization_id: 9,
    active: 1,
  },
};

function editorUser(role = "editor") {
  return {
    id: 77,
    name: "Editor QA",
    role,
    activeOrganizationId: 9,
  };
}

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

test("novo mapa reconcilia storage organizacional bloqueado uma única vez", () => {
  assert.match(
    sources.newMapContext,
    /import \{ ensureOrganizationStorage \} from "\.\.\/\.\.\/\.\.\/_lib\/organization-storage\.js"/,
  );
  assert.match(
    sources.newMapContext,
    /STORAGE_NOT_READY = "ORGANIZATION_STORAGE_NOT_CONFIGURED"/,
  );
  assert.match(
    sources.newMapContext,
    /ensureOrganizationStorage\(env, organization\)/,
  );
  assert.match(
    sources.newMapContext,
    /context = await resolveNewMapCreateContext\(runtimeEnv, request, \{ user \}\)/,
  );
  assert.doesNotMatch(sources.newMapContext, /UPDATE organizations/i);
  assert.doesNotMatch(sources.newMapContext, /while\s*\(|for\s*\(/);
});

test("Viewer é hard-denied na rota de criação", () => {
  assert.match(sources.newMapContext, /normalizeRole\(user\?\.role\) === "viewer"/);
  assert.match(sources.newMapContext, /VIEWER_PROJECT_CREATE_FORBIDDEN/);
  assert.match(sources.newMapContext, /error\.status = 403/);
});

test("rota create de projeto existente continua apenas redirect depreciado", () => {
  assert.match(
    sources.routes,
    /path="\/projects\/:projectSlug\/create"[\s\S]*element=\{<DeprecatedProjectCreateRedirect\s*\/>\}/,
  );
  assert.match(
    sources.canonicalService,
    /PROJECT_CREATE_ROUTE_DEPRECATED/,
  );
  assert.match(
    sources.canonicalService,
    /requestedMode === MAP_PANEL_MODES\.CREATE[\s\S]*status:\s*410/,
  );
});

test("policy v6 resolve exatamente uma rota por projeto", () => {
  assert.match(
    sources.canonicalService,
    /EXISTING_PROJECT_NAVIGATION_POLICY_VERSION = 6/,
  );
  assert.match(sources.canonicalService, /resolveEffectiveProjectMapRoute/);
  assert.match(sources.canonicalService, /const assignedMode = routePolicy\.mode/);
  assert.match(
    sources.canonicalService,
    /const viewerAssigned = assignedMode === PROJECT_MAP_ROUTE_MODES\.VIEWER/,
  );
  assert.match(
    sources.canonicalService,
    /const editorAssigned = assignedMode === PROJECT_MAP_ROUTE_MODES\.EDITOR/,
  );
  assert.match(
    sources.canonicalService,
    /requestedMode !== assignedMode[\s\S]*PROJECT_MAP_ROUTE_NOT_ASSIGNED/,
  );
  assert.doesNotMatch(sources.canonicalService, /defaultExistingProjectPanel/);
});

test("Viewer e Editor nunca são expostos simultaneamente como rotas permitidas", () => {
  assert.match(
    sources.canonicalService,
    /viewer:\s*\{[\s\S]*allowed:\s*viewerAssigned\s*&&\s*Boolean\(assignedModeAllowed\)/,
  );
  assert.match(
    sources.canonicalService,
    /editor:\s*\{[\s\S]*allowed:\s*editorAssigned\s*&&\s*Boolean\(assignedModeAllowed\)/,
  );
  assert.match(sources.canonicalService, /PROJECT_MAP_ROUTE_NOT_ASSIGNED/);
});

test("manage redireciona pela rota atribuída e não prioriza Editor", () => {
  assert.match(sources.management, /context\.defaultPanel === "editor"/);
  assert.match(sources.management, /context\.defaultPanel === "viewer"/);

  const destinationStart = sources.management.indexOf("const destination =");
  const destinationEnd = sources.management.indexOf(
    "if (!destination)",
    destinationStart,
  );
  assert.ok(destinationStart >= 0 && destinationEnd > destinationStart);

  const destinationBlock = sources.management.slice(
    destinationStart,
    destinationEnd,
  );
  assert.doesNotMatch(
    destinationBlock,
    /context\.availablePanels\.(?:editor|viewer)\.allowed/,
  );
});

test("resolver de rota força role Viewer e normaliza legado para Editor", () => {
  assert.match(
    sources.routePolicy,
    /if \(role === "viewer"\)[\s\S]*PROJECT_MAP_ROUTE_MODES\.VIEWER/,
  );
  assert.match(sources.routePolicy, /EDITOR_ACCESS_LEVELS = new Set\(\["editor", "write", "owner"\]\)/);
  assert.match(sources.routePolicy, /if \(role === "super_admin"\)[\s\S]*PROJECT_MAP_ROUTE_MODES\.EDITOR/);
});

test("owner de projeto criado também é nível persistente válido para role Editor", () => {
  assert.match(
    sources.permissions,
    /EDITOR_PROJECT_SAVE_ACCESS_LEVELS = new Set\(\["editor", "write", "owner"\]\)/,
  );
  assert.match(
    sources.largeCreate,
    /VALUES \(\?, \?, 'owner'\)[\s\S]*ON CONFLICT\(user_id, project_id\)/,
  );
  assert.match(
    sources.inlineCreate,
    /VALUES \(\?, \?, 'owner'\)[\s\S]*ON CONFLICT\(user_id, project_id\)/,
  );
});

test("Editor criador com access_level owner pode visualizar, editar mapa e salvar", async () => {
  const env = makePermissionEnv({ accessLevel: "owner" });
  const user = editorUser();

  for (const permission of ["project.view", "project.map.edit", "project.save"]) {
    const decision = await can(env, user, permission, projectContext);
    assert.equal(decision.allowed, true, permission);
  }
});

test("access_level editor e write preservam persistência nativa do Editor", async () => {
  for (const accessLevel of ["editor", "write"]) {
    const env = makePermissionEnv({ accessLevel });
    for (const permission of ["project.map.edit", "project.save"]) {
      const decision = await can(env, editorUser(), permission, projectContext);
      assert.equal(decision.allowed, true, `${accessLevel}:${permission}`);
    }
  }
});

test("Viewer não ganha persistência direta mesmo se existir vínculo owner legado", async () => {
  const env = makePermissionEnv({ accessLevel: "owner" });
  const viewer = editorUser("viewer");

  assert.equal((await can(env, viewer, "project.view", projectContext)).allowed, true);
  assert.equal((await can(env, viewer, "project.map.edit", projectContext)).allowed, false);
  assert.equal((await can(env, viewer, "project.save", projectContext)).allowed, false);
});

test("negação explícita continua prevalecendo sobre ownership do projeto", async () => {
  const env = makePermissionEnv({
    accessLevel: "owner",
    deniedPermission: "project.save",
  });

  const decision = await can(env, editorUser(), "project.save", projectContext);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "USER_PERMISSION_EXPLICITLY_DENIED");
});

test("sem vínculo em user_projects não há acesso implícito ao projeto", async () => {
  const env = makePermissionEnv({ accessLevel: null });

  assert.equal(
    (await can(env, editorUser(), "project.view", projectContext)).allowed,
    false,
  );
  assert.equal(
    (await can(env, editorUser(), "project.save", projectContext)).allowed,
    false,
  );
});

test("modo Viewer bloqueia persistência direta antes dos endpoints de escrita", () => {
  assert.match(
    sources.routePolicy,
    /PROJECT_MAP_VIEWER_PERSISTENCE_FORBIDDEN/,
  );
  assert.match(sources.projectMiddleware, /assertProjectPersistenceRoute/);
  assert.match(sources.projectMiddleware, /targetsViewerRestrictedMutation/);
  assert.match(sources.projectMiddleware, /\/save\\\/\?\$/);
  assert.match(sources.projectMiddleware, /\/metadata\\\/\?\$/);
  assert.match(sources.projectMiddleware, /\/thumbnail/);
  assert.match(
    sources.projectMiddleware,
    /await loadPersistenceContext\(env, request, params\)[\s\S]*return context\.next\(\)/,
  );
});

test("capabilities preparam Change Request somente no workspace Viewer", () => {
  assert.match(
    sources.canonicalService,
    /requestProjectChange:\s*viewerWorkspace\s*&&\s*canViewMap/,
  );
  assert.match(sources.canonicalService, /reviewProjectChange:\s*false/);
  assert.match(sources.canonicalService, /applyProjectChange:\s*false/);
});

test("gestão de mapa grava uma única access_level viewer ou editor", () => {
  assert.match(sources.mapAccessEndpoint, /ROUTE_MODES = new Set\(\["viewer", "editor"\]\)/);
  assert.match(
    sources.mapAccessEndpoint,
    /UPDATE user_projects[\s\S]*SET access_level = \?[\s\S]*WHERE user_id = \? AND project_id = \?/,
  );
  assert.doesNotMatch(sources.mapAccessEndpoint, /INSERT INTO user_projects/);
  assert.match(sources.mapAccessEndpoint, /VIEWER_ROUTE_LOCKED/);
});

test("Create é independente da rota e usa negação explícita", () => {
  assert.match(sources.mapAccessEndpoint, /CREATE_PERMISSION = "project\.create"/);
  assert.match(sources.mapAccessEndpoint, /INSERT INTO user_permission_denials/);
  assert.match(sources.mapAccessEndpoint, /updateProjectCreateAccess|setCreateAccess/);
  assert.match(sources.mapAccessEndpoint, /VIEWER_PROJECT_CREATE_FORBIDDEN/);
});

test("Usuários e Acessos oferece gestor exclusivo de mapa sem substituir permissões adicionais", () => {
  assert.match(sources.usersAccess, /ProjectMapAccessManager/);
  assert.match(sources.usersAccess, />\s*Mapa\s*<\/button>/);
  assert.match(sources.usersAccess, />\s*Gerenciar\s*<\/button>/);
  assert.match(sources.mapAccessManager, /<option value="viewer">Viewer<\/option>/);
  assert.match(sources.mapAccessManager, /<option value="editor">Editor<\/option>/);
  assert.match(sources.mapAccessManager, /viewerRole[\s\S]*disabled=/);
  assert.match(sources.mapAccessManager, /Pode criar novos projetos/);
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

test("projeto existente nunca recebe capacidades exclusivas de criação", () => {
  assert.match(
    sources.canonicalService,
    /openCreateWorkspaceAllowed:\s*false/,
  );
  assert.match(sources.canonicalService, /createProjectAllowed:\s*false/);
  assert.match(sources.canonicalService, /initializeMapAllowed:\s*false/);
});