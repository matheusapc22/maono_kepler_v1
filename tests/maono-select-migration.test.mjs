import { restoreTicketOptionalProgressiveLoading } from "./helpers/ticket-optional-progressive-preservation.mjs";
import { restoreAdminProjectsProgressiveLoading } from "./helpers/admin-projects-progressive-preservation.mjs";
import { restoreTicketDocumentsProgressiveLoading } from "./helpers/ticket-docs-progressive-preservation.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { restoreLimitsPlansLoading } from "./helpers/projects-loading-preservation.mjs";
import { restoreMaonoSelect, maonoSelectDeclarations } from "./helpers/maono-select-preservation.mjs";
import { assertUsersAccessPreserved } from "./helpers/users-access-preservation.mjs";
const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
// These consumers were migrated mechanically from merged PR #221, be531dea.
// Hashing the reversed presentation extraction protects all option/API/permission
// logic, rather than accepting altered business logic as a visual change.
const consumers = {
  "src/components/access/OrganizationPermissionManager.tsx": {
    "sha256": "498d20d17f6d62471665697ea09c7a789d2788829ecac0256d4847e39518dc51",
    "controls": 1
  },
  "src/components/access/ProjectMapAccessManager.tsx": {
    "sha256": "6097d9f35e5a2240082ce148135f60a74dd91e6d23e338a413ead0b8ba3f68a7",
    "controls": 1
  },
  "src/pages/Kepler/change-requests/PointFromPinWorkflow.tsx": {
    "sha256": "fe1dfb493cbdd2434dbb53d890029842280b440548c092c137d184fe6231643e",
    "controls": 1
  },
  "src/pages/Kepler/change-requests/EditorRequestInboxPage.tsx": {
    "sha256": "35cb81c44d8ff3be73d94e75f3377c9a98931bcec283ae19b42f00eef027969d",
    "controls": 1
  },
  "src/pages/Kepler/components/map-overlay/IsochroneDialog.tsx": {
    "sha256": "af99e3d5b4219a7de0b5aeb55d8a8958980855c74d8e5bee762aae9a38b357ee",
    "controls": 1
  },
  "src/pages/Kepler/components/map-overlay/BufferDialog.tsx": {
    "sha256": "b5ebd1548165b682d1099370f949f0faf6949680da20598422e44982440b7a6c",
    "controls": 1
  },
  "src/pages/Kepler/components/maono-layer-panel/LayerStyleEditor.tsx": {
    "sha256": "25584a5d1825effcc7974527838cbc4a8a500d6e2f2818d563d32917f2e105f2",
    // Visual Maõno: refreshed approved presentation; selector subtrees stay pinned to d3c9377.
    "selectorsSha256": "8fcdf5023ac94f16a5cda3ac55dabf42bb8e1020d02d7eacab754dd6e9d68590",
    "controls": 6
  },
  "src/pages/Kepler/components/maono-layer-panel/FilterDetailView.tsx": {
    "sha256": "6b7f755c2c41acba11c8e59698baff0b447a097a83d70d8fe07828e1f2f0890f",
    // Visual Maõno: refreshed approved presentation; selector subtrees stay pinned to d3c9377.
    "selectorsSha256": "79bc2e4f74993deb2cc976613e69e3e7cab759e50db091968eaadc7b5f822978",
    "controls": 2
  },
  "src/pages/Kepler/components/maono-layer-panel/FilterPanel.tsx": {
    "sha256": "515144b5ad886a9e26d0388a3ad8c0ab3a12790d0dc6f5b8452956e8dfbc54fd",
    // Visual Maõno: refreshed approved presentation; selector subtrees stay pinned to d3c9377.
    "selectorsSha256": "816a0ca12b00109b6ecc139ce8de3a4100157993a262eb3fcb19e3c0965ce816",
    "controls": 2
  },
  "src/pages/Kepler/components/maono-layer-panel/LayerInspector.tsx": {
    "sha256": "2373e603649095e7734f7701f78618d65a86fab0fc283e1ff41022d42792adac",
    // Visual Maõno: refreshed approved presentation; selector subtrees stay pinned to d3c9377.
    "selectorsSha256": "ef02702919fe882155a8c9ad36b7b2eb7739831507a51c21e82561dbb9af7e09",
    "controls": 2
  },
  "src/pages/Admin/components/AdminUserManagerLegacy.tsx": {
    "sha256": "462709164e8995dbc10d4e3d36a5bff127076aee7ad6c1dc4acc5a97b7a17bc7",
    "controls": 7
  },
  "src/pages/Projects/components/DocumentsSection.tsx": {
    "sha256": "736bc1aba68b30ffd0250ccea8f69e70b3a488e6e4e12d4f0b2d4b276814b627",
    "controls": 4
  },
  "src/pages/Projects/components/ExportsSection.tsx": {
    "sha256": "bb2c5590c57393121c57163ae006c2a7f5ce2eada286e68595912b132a6b33a6",
    "controls": 2
  },
  "src/pages/Projects/components/LimitsPlansSection.tsx": {
    "sha256": "47987125e6dc7c86e1adf810f3325c8a5b905659f8724d5242596b4eb0564042",
    "restore": restoreLimitsPlansLoading,
    "controls": 2
  },
  "src/pages/Projects/components/UsersAccessOverviewSection.tsx": {
    // This redesigned consumer has an independent pre-redesign AST/byte
    // contract. Every other consumer keeps its original full-source hash.
    "preserve": assertUsersAccessPreserved,
    "controls": 2
  },
  "src/pages/Projects/components/TicketCasesPanel.tsx": {
    "sha256": "6ec988b4cc92af1e3ed9946324060cb8a11d96f8985bd98bdb661b4b5b90353f",
    "controls": 9
  },
  "src/pages/Projects/components/DocumentsPagination.tsx": {
    "sha256": "96dc634f2c1398991796515cd4216be286ebf20dcd45f068852f5154c0a216f9",
    "controls": 1
  },
  "src/pages/Projects/components/TicketExportsPanel.tsx": {
    "sha256": "e1312562f90f646b6f25e4bac7ec82cdfded3e70c9349d15fe727ab0f3619103",
    "controls": 3
  },
  "src/pages/Projects/components/TicketSlaPanel.tsx": {
    "sha256": "603ce8e7834aa23ee5cd318cf1a397312e6ffe4678d97ac6b61db7365daadd0f",
    "controls": 1
  },
  "src/pages/Projects/components/TicketTriageFields.tsx": {
    "sha256": "ac5b7f62ed53b4097fab4a8a0d5cf7ca2830a62beebafd3ac36f65270ff862c1",
    "controls": 3
  },
  "src/pages/Projects/components/TicketKnowledgePanel.tsx": {
    "sha256": "6e743ee4910dbd2342344a34aa8bed88bd7bb0b5e4488ed2ee7f8cc444019e13",
    "controls": 5
  },
  "src/pages/Projects/components/TicketDetailDrawer.tsx": {
    "sha256": "a0c19fa754c8891256c7e1d6cd39260636949016211ac79bc799c66f0a3c4778",
    "controls": 4
  },
  "src/pages/Projects/components/NewTicketPopover.tsx": {
    "sha256": "f415fa33a739e87d36d455c0a300511564b392515d992390c28d9658fb9b7107",
    "controls": 3
  },
  "src/pages/Projects/components/TicketFeedbackPanel.tsx": {
    "sha256": "58efe5a5af0e85e28e3639e50d34c4fc6d1e9fcf7753fac80952b1e2b2313b47",
    "controls": 3
  },
  "src/pages/Projects/components/TicketChanges.tsx": {
    "sha256": "1b3deab817d8f389279a3a1ca59d939a768745990fbe04b2a4109c61637c3b5d",
    "controls": 1
  },
  "src/pages/Projects/components/ProjectPagesUi.tsx": {
    "sha256": "615271618e0472efab5f398a4a92cb70bacc0de93325f46c53af3d655bd011e1",
    "controls": 3
  },
  "src/pages/Projects/components/TicketLifecyclePanel.tsx": {
    "sha256": "ab5c95d8a4a77adbe141425337b895b14ef7d6ed08491cbd4acd8ee25d34647a",
    "controls": 4
  }
};
for (const [path, contract] of Object.entries(consumers)) {
  test(`shared selector preserves all consumer logic: ${path}`, () => {
    const source = restoreAdminProjectsProgressiveLoading(path, restoreTicketDocumentsProgressiveLoading(path, restoreTicketOptionalProgressiveLoading(path, read(path))));
    assert.equal((source.match(/<MaonoSelect\b/g) || []).length, contract.controls);
    if (contract.selectorsSha256) assert.equal(createHash("sha256").update(maonoSelectDeclarations(source)).digest("hex"), contract.selectorsSha256);
    if (contract.preserve) contract.preserve(source);
    else assert.equal(createHash("sha256").update(restoreMaonoSelect(contract.restore ? contract.restore(source) : source)).digest("hex"), contract.sha256);
  });
}
function files(directory) {
  return readdirSync(new URL(directory, root), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]);
}
test("all runtime native single-select declarations use the shared branded component", () => {
  const native = files("src").filter(path => path.endsWith(".tsx") && /<select\b/.test(read(path)));
  assert.deepEqual(native.sort(), ["src/components/selection/MaonoSelect.tsx", "src/pages/AdminFiles.tsx"]);
  // AdminFiles is retained only as an old test fixture. It has no runtime import.
  const runtime = files("src").filter(path => /\.(tsx?|jsx?)$/.test(path) && path !== "src/pages/AdminFiles.tsx");
  assert.ok(runtime.every(path => !/from ["'][^"']*AdminFiles["']/.test(read(path))));
});
test("the shared control retains native forms, branded DOM popup and no business side effects", () => {
  const source = read("src/components/selection/MaonoSelect.tsx");
  assert.match(source, /forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>/);
  assert.match(source, /<select \{\.\.\.props\}/);
  assert.match(source, /select\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
  assert.match(source, /createPortal\(/);
  assert.match(source, /popover="manual" role="listbox"/);
  assert.match(source, /aria-activedescendant/);
  assert.match(source, /select\.form\?\.addEventListener\("reset"/);
  assert.doesNotMatch(source, /\bfetch\(|localStorage|sessionStorage|window\.alert/);
  const css = read("src/components/selection/maono-select.css");
  assert.match(css, /transform-origin: center/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /forced-colors/);
  assert.match(css, /pointer: coarse/);
});


test("the known fallback white styles cannot override migrated controls in standalone shells", () => {
  const css = read("src/components/selection/maono-select.css");
  assert.match(css, /#root > :is\(\.maono-admin-page, \.maono-editor-inbox, \.maono-review-page\) \.maono-select > select\[data-maono-select\]/);
  assert.match(css, /-webkit-text-fill-color: currentColor !important/);
  assert.match(css, /#root \.maono-admin-page \.admin-user-filters input/);
  // The fallback injector and all its unrelated layout/button rules stay intact.
  assert.match(read("src/fallback-ui-styles.ts"), /#root > main:not\(\.maono-login-page, \.mm-projects-page\)/);
});
