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
const placeholder = await readFile(
  new URL(
    "../src/pages/Projects/components/ProjectMapPlaceholder.tsx",
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

test("grade não fica bloqueada aguardando todos os PNGs", () => {
  assert.doesNotMatch(section, /settledThumbnailKeys/);
  assert.doesNotMatch(section, /allVisibleThumbnailsSettled/);
  assert.doesNotMatch(section, /holdThumbnailShimmer/);
  assert.match(section, /aria-busy=\{loading\}/);
});

test("card mostra SVG imediato e só revela PNG depois de decode", () => {
  assert.match(card, /<ProjectMapPlaceholder/);
  assert.match(card, /typeof image\.decode === "function"/);
  assert.match(card, /await image\.decode\(\)/);
  assert.match(card, /thumbnailLoaded \? "is-loaded" : "is-loading"/);
  assert.match(card, /loading="lazy"/);
  assert.match(card, /onError=\{handleThumbnailError\}/);
});

test("fallback é determinístico por organização e slug sem dados do mapa", () => {
  assert.match(
    placeholder,
    /project\.organizationId \?\? project\.organization_id/,
  );
  assert.match(placeholder, /project\.slug/);
  assert.match(placeholder, /function stableSeed/);
  assert.match(placeholder, /const PALETTES = \[/);
  assert.doesNotMatch(placeholder, /datasets|GeoJSON|longitude|latitude/);
  assert.match(cardStyles, /--project-preview-ratio:\s*16 \/ 9/);
  assert.match(cardStyles, /aspect-ratio:\s*var\(--project-preview-ratio\)/);
});

test("somente READY ou legado UNKNOWN tentam carregar imagem real", () => {
  assert.match(
    utils,
    /!\["READY", "UNKNOWN"\]\.includes\(status\)/,
  );
  assert.match(utils, /project\.thumbnailRevision/);
  assert.match(utils, /thumbnail\?v=/);
});

test("PENDING usa polling progressivo e cancelável", () => {
  assert.match(section, /project\.thumbnailStatus === "PENDING"/);
  assert.match(section, /\[2000, 4000, 8000, 15000\]/);
  assert.match(section, /new AbortController\(\)/);
  assert.match(section, /controller\.abort\(\)/);
  assert.match(section, /window\.clearTimeout\(timer\)/);
});

test("transição não causa flash e respeita redução de movimento", () => {
  assert.match(
    cardStyles,
    /mm-project-card__preview img[\s\S]*opacity:\s*0/,
  );
  assert.match(
    cardStyles,
    /mm-project-card__preview img\.is-loaded[\s\S]*opacity:\s*1/,
  );
  assert.match(cardStyles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(skeletonStyles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(skeletonStyles, /animation:\s*none/);
});

test("altura fixa legada e shimmer de sidebar permanecem ausentes", () => {
  assert.doesNotMatch(cardStyles, /156px/);
  assert.doesNotMatch(skeletonStyles, /height:\s*156px/);
  assert.doesNotMatch(
    skeletonStyles,
    /\.mm-projects-sidebar[^}]*animation:\s*mm-shimmer/s,
  );
});
