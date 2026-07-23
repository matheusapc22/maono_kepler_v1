import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const card = await readFile(
  new URL(
    "../src/pages/Projects/components/ProjectCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
const section = await readFile(
  new URL(
    "../src/pages/Projects/components/ProjectsSection.tsx",
    import.meta.url,
  ),
  "utf8",
);
const utils = await readFile(
  new URL(
    "../src/pages/Projects/components/project-card-utils.ts",
    import.meta.url,
  ),
  "utf8",
);
const cardStyles = await readFile(
  new URL(
    "../src/pages/Projects/components/project-cards.css",
    import.meta.url,
  ),
  "utf8",
);
const skeletonStyles = await readFile(
  new URL("../src/components/loading/Skeleton.css", import.meta.url),
  "utf8",
);

test("thumbnail gate keeps stable keys and settled state", () => {
  assert.match(utils, /export function projectThumbnailKey/);
  assert.match(section, /settledThumbnailKeys/);
  assert.match(section, /allVisibleThumbnailsSettled/);
  assert.match(section, /visibleThumbnailKeys\.every/);
  assert.match(section, /holdThumbnailShimmer=\{thumbnailsPending\}/);
});

test("thumbnail load waits for decode and error settles the gate", () => {
  assert.match(card, /typeof image\.decode === "function"/);
  assert.match(card, /await image\.decode\(\)/);
  assert.match(card, /onThumbnailSettled\?\.\(project\)/);
  assert.match(card, /onError=\{handleThumbnailError\}/);
  assert.match(card, /loading="eager"/);
});

test("fallback is textual, accessible and keeps 16:9 geometry", () => {
  assert.match(card, /Prévia indisponível/);
  assert.match(card, /role="img"/);
  assert.match(cardStyles, /--project-preview-ratio:\s*16 \/ 9/);
  assert.match(cardStyles, /aspect-ratio:\s*var\(--project-preview-ratio\)/);
});

test("legacy fixed thumbnail height and sidebar shimmer are absent", () => {
  assert.doesNotMatch(cardStyles, /156px/);
  assert.doesNotMatch(skeletonStyles, /height:\s*156px/);
  assert.doesNotMatch(
    skeletonStyles,
    /\.mm-projects-sidebar[^}]*animation:\s*mm-shimmer/s,
  );
});

test("reduced motion disables card and shimmer movement", () => {
  assert.match(cardStyles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(skeletonStyles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(skeletonStyles, /animation:\s*none/);
});
