import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const guardModule = await import("../functions/_lib/geojson-access.js");
const permissions = await readFile(new URL("../functions/_lib/permissions.js", import.meta.url), "utf8");
const organizations = await readFile(new URL("../functions/_lib/organizations.js", import.meta.url), "utf8");
const listing = await readFile(new URL("../functions/api/organizations/[id]/files.js", import.meta.url), "utf8");
const download = await readFile(new URL("../functions/api/organizations/[id]/files/[fileId]/download.js", import.meta.url), "utf8");
const grantRoute = await readFile(new URL("../functions/api/organizations/[id]/users/[userId]/permissions.js", import.meta.url), "utf8");
const commercial = await readFile(new URL("../src/pages/Projects/components/user-access-commercial.ts", import.meta.url), "utf8");

test("classifica somente JSON/GeoJSON vinculados a projeto como protegidos", () => {
  assert.equal(guardModule.isProjectGeoJsonFile({ project_id: 10, file_type: "geojson", name: "mapa.geojson" }), true);
  assert.equal(guardModule.isProjectGeoJsonFile({ project_id: 10, file_type: "json", name: "mapa.json", mime_type: "application/json" }), true);
  assert.equal(guardModule.isProjectGeoJsonFile({ project_id: null, file_type: "geojson", name: "livre.geojson" }), false);
  assert.equal(guardModule.isProjectGeoJsonFile({ project_id: 10, file_type: "pdf", name: "relatorio.pdf" }), false);
});

test("permissão ampla não é padrão e só super admin pode gerenciá-la", () => {
  assert.match(permissions, /organization\.projects\.geojson\.view/);
  assert.doesNotMatch(permissions.match(/const OWNER_ORGANIZATION_PERMISSIONS[\s\S]*?\]\);/)?.[0] ?? "", /organization\.projects\.geojson\.view/);
  assert.match(organizations, /Somente Super Admin pode gerenciar o acesso amplo a GeoJSON/);
  assert.match(grantRoute, /SUPER_ADMIN_REQUIRED/);
});

test("listagem filtra e download repete autorização antes dos bytes", () => {
  assert.match(listing, /filterVisibleOrganizationFiles/);
  assert.match(download, /requireProjectGeoJsonAccess/);
  assert.ok(download.indexOf("requireProjectGeoJsonAccess") < download.indexOf("downloadOrganizationBinary\(env"));
  assert.match(`${listing}\n${download}`, /private, no-store/);
});

test("viewer continua elegível mediante concessão explícita e aviso", () => {
  assert.match(commercial, /Visualizar GeoJSON de todos os projetos da organização/);
  assert.match(commercial, /platformOnly: true/);
  assert.match(commercial, /modo somente leitura/);
});
