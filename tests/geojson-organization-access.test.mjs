import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { can } from "../functions/_lib/permissions.js";
import { authorizeOrganizationPermissionMutation } from "../functions/_lib/access-governance.js";
import { persistenceFixture } from "./helpers/project-persistence-fixture.mjs";

const guardModule = await import("../functions/_lib/geojson-access.js");
const permissions = await readFile(new URL("../functions/_lib/permissions.js", import.meta.url), "utf8");
const organizations = await readFile(new URL("../functions/_lib/organizations.js", import.meta.url), "utf8");
const listing = await readFile(new URL("../functions/api/organizations/[id]/files.js", import.meta.url), "utf8");
const download = await readFile(new URL("../functions/api/organizations/[id]/files/[fileId]/download.js", import.meta.url), "utf8");
const deletion = await readFile(new URL("../functions/api/organizations/[id]/files/[fileId].js", import.meta.url), "utf8");
const grantRoute = await readFile(new URL("../functions/api/organizations/[id]/users/[userId]/permissions.js", import.meta.url), "utf8");
const commercial = await readFile(new URL("../src/pages/Projects/components/user-access-commercial.ts", import.meta.url), "utf8");

test("classifica JSON/GeoJSON atuais e legados como protegidos", () => {
  assert.equal(guardModule.isProjectGeoJsonFile({ project_id: 10, file_type: "geojson", name: "mapa.geojson" }), true);
  assert.equal(guardModule.isProjectGeoJsonFile({ project_id: 10, file_type: "json", name: "mapa.json", mime_type: "application/json" }), true);
  assert.equal(guardModule.isProjectGeoJsonFile({ project_id: null, file_type: null, name: "config.kepler.json" }), true);
  assert.equal(guardModule.isProjectGeoJsonFile({ project_id: null, file_type: null, original_name: "Projeto_MRA_v1.json" }), true);
  assert.equal(guardModule.isProjectGeoJsonFile({ project_id: null, file_type: "geojson", name: "livre.geojson" }), true);
  assert.equal(guardModule.isProjectGeoJsonFile({ project_id: 10, file_type: "pdf", name: "relatorio.pdf" }), false);
});

test("permissão ampla não é padrão e só super admin pode gerenciá-la", async (t) => {
  assert.match(permissions, /organization\.projects\.geojson\.view/);
  assert.doesNotMatch(permissions.match(/const OWNER_ORGANIZATION_PERMISSIONS[\s\S]*?\]\);/)?.[0] ?? "", /organization\.projects\.geojson\.view/);
  assert.match(organizations, /Somente Super Admin pode gerenciar o acesso amplo a GeoJSON/);
  assert.match(grantRoute, /await authorizeOrganizationPermissionMutation\(/);
  assert.ok(grantRoute.indexOf("await authorizeOrganizationPermissionMutation(") < grantRoute.indexOf("await grantOrganizationPermission("));
  const { db, env } = persistenceFixture(t);
  db.exec(`INSERT INTO users (id,email,role,password_hash) VALUES (3,'target@offline.invalid','viewer','not-a-login');
    INSERT INTO organization_users (organization_id,user_id,access_level) VALUES (1,3,'viewer');`);
  const permission = "organization.projects.geojson.view";
  for (const role of ["client", "admin", "editor", "viewer"]) {
    db.prepare("UPDATE users SET role=? WHERE id=1").run(role);
    const actor = { id: 1, role, activeOrganizationId: 1 };
    assert.equal((await can(env, actor, permission, { organizationId: 1 })).allowed, false, role);
    for (const operation of ["grant", "revoke"]) {
      await assert.rejects(authorizeOrganizationPermissionMutation({
        env, actor, organizationId: 1, targetUserId: 3, permission, operation,
      }), (error) => error.status === 403 && error.code === "OWNER_CEILING_EXCEEDED", `${role}/${operation}`);
    }
  }
  for (const operation of ["grant", "revoke"]) {
    const decision = await authorizeOrganizationPermissionMutation({
      env, actor: { id: 1, role: "super_admin" }, organizationId: 1,
      targetUserId: 3, permission, operation,
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.reason, "SUPER_ADMIN");
  }
});

test("listagem, download e exclusão repetem a autorização GeoJSON", () => {
  assert.match(listing, /decideProjectGeoJsonAccess/);
  assert.match(listing, /listOrganizationFilesPage/);
  assert.match(download, /requireProjectGeoJsonAccess/);
  assert.match(deletion, /requireProjectGeoJsonAccess/);
  assert.ok(download.indexOf("requireProjectGeoJsonAccess") < download.indexOf("downloadOrganizationBinary\(env"));
  assert.ok(deletion.indexOf("requireProjectGeoJsonAccess") < deletion.indexOf("deleteOrganizationBinary\(env"));
  assert.match(`${listing}\n${download}`, /private, no-store/);
});

test("document.view e vínculo direto não revelam GeoJSON sem concessão ampla", () => {
  const guardSource = String(guardModule.decideProjectGeoJsonAccess);
  assert.doesNotMatch(guardSource, /project\.view/);
  assert.doesNotMatch(guardSource, /direct_project/);
  assert.match(guardSource, /ORGANIZATION_GEOJSON_VIEW_PERMISSION/);
  assert.equal(guardModule.isProjectGeoJsonFile({ project_id: 7, file_type: "geojson", name: "restrito.geojson" }), true);
});

test("arquivo JSON legado sem project_id exige a concessão organizacional", () => {
  const guardSource = String(guardModule.decideProjectGeoJsonAccess);
  assert.match(guardSource, /if \(projectId\)/);
  assert.match(guardSource, /ORGANIZATION_GEOJSON_VIEW_PERMISSION/);
  assert.equal(guardModule.isProjectGeoJsonFile({ name: "Projeto_MRA_v1.json" }), true);
});

test("negação oculta a existência do arquivo protegido", async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return { first: async () => ({ id: 7, organization_id: 3, project_active: 1, organization_active: 1 }) };
        },
      };
    },
  };
  await assert.rejects(
    guardModule.requireProjectGeoJsonAccess(
      { DB: db },
      new Request("https://example.test/file"),
      { id: 99, role: "viewer" },
      3,
      { id: 8, project_id: 7, file_type: "geojson", name: "restrito.geojson" },
    ),
    (error) => error?.status === 404 && error?.code === "ORGANIZATION_FILE_NOT_FOUND",
  );
});

test("viewer continua elegível mediante concessão explícita e aviso", () => {
  assert.match(commercial, /Visualizar GeoJSON de todos os projetos da organização/);
  assert.match(commercial, /platformOnly: true/);
  assert.match(commercial, /modo somente leitura/);
});
