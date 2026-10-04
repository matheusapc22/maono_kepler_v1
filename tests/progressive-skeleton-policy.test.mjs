import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_PROLONGED_LOADING_MS,
  estimateSkeletonCount,
  resolveRegionState,
  isRegionAccessDenied,
  isRegionAuthenticationError,
} from "../src/components/loading/region-loading-policy.ts";

const skeleton = await readFile(new URL("../src/components/loading/Skeleton.tsx", import.meta.url), "utf8");
const countHook = await readFile(new URL("../src/components/loading/useSkeletonCount.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../src/components/loading/Skeleton.css", import.meta.url), "utf8");

test("region policy distinguishes initial, refresh, data, empty, error and cancellation", () => {
  assert.equal(resolveRegionState({ loading: true, hasData: false }), "initial");
  assert.equal(resolveRegionState({ loading: true, hasData: true }), "refreshing");
  assert.equal(resolveRegionState({ loading: false, hasData: true }), "ready");
  assert.equal(resolveRegionState({ loading: false, hasData: false }), "empty");
  assert.equal(resolveRegionState({ loading: true, hasData: false, error: new Error("failed") }), "error");
  assert.equal(resolveRegionState({ loading: true, hasData: false, cancelled: true }), "cancelled");
});

test("table estimates track visible height and are capped by pagination and known metadata", () => {
  assert.equal(estimateSkeletonCount({ viewportHeight: 680, reservedHeight: 200, itemHeight: 48 }), 10);
  assert.equal(estimateSkeletonCount({ viewportHeight: 1000, pageSize: 5 }), 5);
  assert.equal(estimateSkeletonCount({ viewportHeight: 1000, pageSize: 10, knownCount: 3 }), 3);
  assert.equal(estimateSkeletonCount({ knownCount: 0 }), 0);
  assert.ok(estimateSkeletonCount({}) > 0, "unknown is not represented as zero results");
});

test("grid estimates match existing mobile/tablet/desktop breakpoints without excessive rows", () => {
  const common = { layout: "grid", viewportHeight: 900, reservedHeight: 300, itemHeight: 360 };
  assert.equal(estimateSkeletonCount({ ...common, viewportWidth: 390 }), 2);
  assert.equal(estimateSkeletonCount({ ...common, viewportWidth: 1024 }), 4);
  assert.equal(estimateSkeletonCount({ ...common, viewportWidth: 1440 }), 6);
  assert.equal(estimateSkeletonCount({ ...common, viewportWidth: 1440, knownCount: 4 }), 4);
});

test("count estimates are deterministic, bounded and safe with unavailable viewport metadata", () => {
  const options = { layout: "list", viewportHeight: 850, reservedHeight: 230, itemHeight: 72, pageSize: 50 };
  assert.equal(estimateSkeletonCount(options), estimateSkeletonCount(options));
  assert.ok(estimateSkeletonCount({ viewportHeight: 100_000 }) <= 12);
  assert.ok(estimateSkeletonCount({ layout: "grid", viewportHeight: 100_000 }) <= 9);
  assert.equal(estimateSkeletonCount({ viewportHeight: 1, reservedHeight: 9000 }), 1);
  assert.ok(Number.isFinite(estimateSkeletonCount({ viewportHeight: NaN, viewportWidth: Infinity, itemHeight: -2, pageSize: -1, knownCount: -4 })));
});

test("static placeholders reserve dimensions before a one-time animation-only onset", () => {
  assert.match(css, /--mm-skeleton-activation-delay:\s*160ms/);
  assert.match(css, /animation-delay:\s*calc\(var\(--mm-skeleton-activation-delay\)/);
  assert.match(css, /--mm-skeleton-group-offset:/);
  assert.match(css, /background:\s*var\(--mm-skeleton-base\)/);
  assert.match(css, /@keyframes mm-shimmer\s*\{\s*to\s*\{\s*transform:/);
  assert.doesNotMatch(skeleton.slice(skeleton.indexOf("export function Skeleton("), skeleton.indexOf("export function TableSkeleton(")), /setTimeout|useEffect|loading|opacity:\s*0/);
  assert.doesNotMatch(css, /will-change:/);
  for (const token of ["base", "highlight", "duration", "intensity", "direction", "radius", "transition"]) assert.ok(css.includes(`--mm-skeleton-${token}:`));
});

test("decorative placeholders cannot override hidden or keyboard-inert semantics", () => {
  assert.match(skeleton, /\{\.\.\.props\}\s+aria-hidden="true"\s+tabIndex=\{-1\}\s+contentEditable=\{false\}\s+children=\{null\}/);
  assert.match(css, /\.mm-skeleton\s*\{[^}]*pointer-events:\s*none/s);
});

test("table headers remain structural real text and only data rows are hidden", () => {
  const table = skeleton.slice(skeleton.indexOf("export function TableSkeleton("), skeleton.indexOf("export function MetricsSkeleton("));
  assert.doesNotMatch(table.slice(0, table.indexOf("<table>")), /aria-hidden/);
  assert.match(table, /<th key=\{header\} scope="col">\{header\}<\/th>/);
  assert.match(table, /<tbody aria-hidden="true">/);
});

test("route fallbacks have one sibling live status and retain public known titles", () => {
  const projects = skeleton.slice(skeleton.indexOf("export function ProjectsPageSkeleton("), skeleton.indexOf("function AdminSectionSkeleton("));
  const admin = skeleton.slice(skeleton.indexOf("export function AdminPageSkeleton("));
  assert.match(projects, /<h1>Projetos<\/h1>/);
  assert.match(projects, /<ProjectGridSkeleton announce=\{false\} \/>/);
  for (const route of [projects, admin]) {
    assert.match(route, /<\/main>\s*<LoadingStatus loading/);
    assert.equal((route.match(/<LoadingStatus/g) ?? []).length, 1);
    assert.doesNotMatch(route, /<main[^>]*aria-busy/);
  }
});

test("one prolonged message has timer cleanup and supports existing live-region owners", () => {
  assert.equal(DEFAULT_PROLONGED_LOADING_MS, 8_000);
  assert.match(skeleton, /if \(!loading\) return;/);
  assert.match(skeleton, /return \(\) => window\.clearTimeout\(timer\)/);
  assert.match(skeleton, /role=\{announce \? "status" : undefined\}/);
  assert.match(skeleton, /visuallyHidden = true/);
  assert.match(skeleton, /const isProlonged = loading && prolonged/);
  assert.match(css, /\.mm-loading-status\.is-prolonged\s*\{/);
});

test("responsive estimates release their listener and media shimmer is confined to pending image", () => {
  assert.match(countHook, /window\.addEventListener\("resize", update, \{ passive: true \}\)/);
  assert.match(countHook, /return \(\) => \{\s*window\.removeEventListener\("resize", update\)/);
  assert.match(countHook, /observer\?\.disconnect\(\)/);
  assert.match(countHook, /gridTemplateColumns/);
  assert.doesNotMatch(css, /\.mm-project-card\.is-media-pending/);
  assert.doesNotMatch(css, /\.mm-project-skeleton:nth-child/);
  assert.match(css, /\.mm-project-card__preview \.mm-skeleton-fill\s*\{\s*position:\s*absolute;\s*inset:\s*0/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.mm-skeleton::after\s*\{\s*animation:\s*none;/);
  assert.equal((css.match(/\.mm-project-card__preview img\.is-loaded\s*\{/g) ?? []).length, 2, "only base and reduced-motion transition rules remain");
});


test("access denials invalidate regional data while transient failures retain cache eligibility", () => {
  for (const error of [{ status: 401 }, { status: 403 }, { category: "AUTH" }, { category: "PERMISSION" }, { code: "AUTH_SESSION_EXPIRED" }, { code: "PERMISSION_DENIED" }]) assert.equal(isRegionAccessDenied(error), true);
  for (const error of [null, new Error("Network failure"), { status: 503 }, { category: "INFRASTRUCTURE" }]) assert.equal(isRegionAccessDenied(error), false);
  assert.equal(isRegionAuthenticationError({ status: 401 }), true);
  assert.equal(isRegionAuthenticationError({ status: 403 }), false);
  assert.equal(isRegionAuthenticationError({ status: 403, code: "AUTH_PERMISSION_DENIED", category: "AUTH" }), false);
  assert.equal(isRegionAccessDenied({ status: 403, code: "AUTH_PERMISSION_DENIED", category: "AUTH" }), true);
});
