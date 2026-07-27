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

test("card limita o SVG à apresentação de geração e conclui no decode", () => {
  assert.match(
    card,
    /showGenerationSvg \? \(\s*<ProjectMapPlaceholder/,
  );
  assert.match(card, /resolvePreviewPresentation\(\{/);
  assert.match(card, /generationRevision/);
  assert.match(card, /decodedRevision/);
  assert.match(card, /previousReadyUrl/);
  assert.match(card, /typeof image\.decode === "function"/);
  assert.match(card, /await image\.decode\(\)/);
  assert.match(
    card,
    /displayImageDecoded \? "is-loaded" : "is-loading"/,
  );
  assert.match(
    card,
    /loading=\{showGenerationSvg \? "eager" : "lazy"\}/,
  );
  assert.match(card, /onError=\{handleDisplayedImageError\}/);
  assert.match(card, /VITE_PROJECT_PREVIEW_TRANSITION_V2/);
});

test("SVG de geração é determinístico e não representa falha ou ausência", () => {
  assert.match(
    placeholder,
    /project\.organizationId \?\? project\.organization_id/,
  );
  assert.match(placeholder, /project\.slug/);
  assert.match(placeholder, /function stableSeed/);
  assert.match(placeholder, /const PALETTES = \[/);
  assert.match(placeholder, /data-preview-status="PENDING"/);
  assert.doesNotMatch(
    placeholder,
    /imageFailed|FAILED|MISSING/,
  );
  assert.doesNotMatch(placeholder, /datasets|GeoJSON|longitude|latitude/);
  assert.match(cardStyles, /--project-preview-ratio:\s*16 \/ 9/);
  assert.match(cardStyles, /aspect-ratio:\s*var\(--project-preview-ratio\)/);
});

test("READY e UNKNOWN carregam imagem; falhas usam fallback neutro ou anterior", () => {
  assert.match(
    utils,
    /!\["READY", "UNKNOWN"\]\.includes\(status\)/,
  );
  assert.match(utils, /project\.thumbnailRevision/);
  assert.match(utils, /thumbnail\?v=/);
  assert.match(utils, /projectPreviousReadyThumbnailUrl/);
  assert.match(card, /ProjectPreviewNeutralState/);
  assert.match(cardStyles, /is-loading-neutral/);
  assert.match(cardStyles, /is-missing-neutral/);
  assert.match(cardStyles, /is-failed-neutral/);
});

test("PENDING usa polling progressivo e cancelável", () => {
  assert.match(section, /normalizeProjectThumbnailStatus\(/);
  assert.match(section, /\) === "PENDING"/);
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

test("cache de decode é contextual e a key não depende da revisão", () => {
  assert.match(utils, /const decodedThumbnailUrls = new Set<string>\(\)/);
  assert.match(utils, /activateProjectThumbnailCacheContext/);
  assert.match(utils, /rememberProjectThumbnailDecoded/);
  assert.match(utils, /projectCardKey/);
  assert.match(section, /key=\{projectCardKey\(project\)\}/);
  assert.match(
    section,
    /activateProjectThumbnailCacheContext\(/,
  );
  assert.doesNotMatch(
    utils.match(
      /export function projectCardKey[\s\S]*?\n\}/,
    )?.[0] || "",
    /projectThumbnailUrl/,
  );
});

test("aria-busy acompanha geração real, não o carregamento inicial", () => {
  assert.match(card, /const previewBusy =/);
  assert.match(card, /aria-busy=\{previewBusy\}/);
  assert.match(
    card,
    /thumbnailStatus === "READY"[\s\S]*showGenerationSvg/,
  );
});

test("altura fixa legada e shimmer de sidebar permanecem ausentes", () => {
  assert.doesNotMatch(cardStyles, /156px/);
  assert.doesNotMatch(skeletonStyles, /height:\s*156px/);
  assert.doesNotMatch(
    skeletonStyles,
    /\.mm-projects-sidebar[^}]*animation:\s*mm-shimmer/s,
  );
});
