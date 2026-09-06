import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("viewer encapsulates the local changes notice as a compact glowing trigger", () => {
  const workflow = read("src/pages/Kepler/change-requests/PointFromPinWorkflow.tsx");
  const css = read("src/pages/Kepler/change-requests/point-from-pin.css");

  assert.match(
    workflow,
    /viewerWorkspaceVisible && operations\.length[\s\S]*maono-change-request__bar/,
  );
  assert.match(workflow, /onClick=\{openDrawer\}/);
  assert.match(css, /\.maono-change-request__bar\s*\{[\s\S]*right:\s*24px;[\s\S]*bottom:\s*55px;/);
  assert.match(css, /\.maono-change-request__bar-copy\s*\{\s*display:\s*none;/);
  assert.match(css, /@keyframes\s+maono-change-request-attention/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("viewer route removes tooltip configuration capability", () => {
  const provider = read("src/pages/Kepler/map-panel/MapPanelProvider.tsx");

  assert.match(provider, /function viewerPresentationContext\(/);
  assert.match(provider, /context\.mode !== "viewer"/);
  assert.match(provider, /configureTooltips:\s*false/);
  assert.match(provider, /viewerPresentationContext\(routedContext\)/);
});
