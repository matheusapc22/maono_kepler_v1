# Project preview capture: local evidence

Measured 2026-10-06 at 03:11 UTC on the settled refactor worktree after the consumed-clustering correction. The complete matrix passed 104 cases; the persisted measurement report separately records a 16-case evidence rerun. Source-file hashes are retained in `measurements.json`; the historical comparison uses `af652fe47b9f56ed8910b50aab0f1367645bd770`. This is synthetic local validation, not Production acceptance or a physical-device/GPU certification.

## Verified

- 104 browser cases passed: 26 each in Chromium, WebKit, Pixel 7 emulation (Chromium), and iPhone 13 emulation (WebKit).
- The focused native-aggregation/capture selection passed 50 Node cases, including 16 new consumed-clustering regressions.
- Real PNG decode and pixel-for-pixel comparisons preserve 960×540 and alpha on light/dark scenes, including already-rendered polygon, point/cluster, heatmap and tilted-grid pixels. These complex-layer pixels are synthetic fixtures; they are not a mounted Kepler GPU-layer acceptance suite.
- Registered source canvases only; foreign, hidden and clipped-out canvases cannot enter the result. Unknown visible surfaces fail closed.
- A later edit/root unmount after freeze cannot change the PNG. A pre-freeze generation change rejects capture. Duplicate work is shared and superseded work cancels.
- External Point/GeoJSON clustering policy changes now require immutable construction receipts and actually materialized/drawn data, even when native references and camera stay unchanged. Eight real-Deck cases delay commit and verify that the old frame stays pending; see [the scoped evidence](cluster-consumption.md) and [decoded results](cluster-consumed-render-results.json).
- Same-camera layer/filter/style changes wait for the consumed MapContainer generation and actual Deck `onAfterRender` acknowledgment. Each split viewport is proved separately.
- Bottom basemap and top-label map require the expected style identity, tiles, camera, and their own actual rendered-frame acknowledgment. Node regressions cover a new top token appearing before its canvas renders and delayed completion of the second split viewport.
- Actual MapLibre style-diff cases ran in Chromium and WebKit. A changed style publishes its new token; a semantically equal replacement retains the token. Cache teardown/reuse has a regression test.
- Actual raw WebGL copying and context-loss rejection ran in Chromium and WebKit. This uses synthetic local WebGL, not remote tiles or a user's GPU.
- Tainted canvases fail as degraded; the generated technical fallback is never labelled faithful. Unsupported manual heatmap/cluster/filter reconstruction is explicitly skipped. Faithful pixels are never redrawn by the approximate overlay.
- Array-row scanning preserves visible points after row 12,000, stops at the existing 8,000 visible-point limit, and yields/cancels in chunks.
- Fonts, tiles, hidden documents, missing frames, cancellation and late resource disposal have focused Node coverage. Frozen html2canvas fallback, cancellation, cleanup and a single PNG encode have browser coverage.

## Measurements

Linux x64 container, AMD EPYC 9V74, 9 visible logical CPUs. Playwright 1.55.0. Exact browser versions and full per-case results are in `measurements.json`. Engines were headless; emulated mobile used the same server CPU. The host was shared with other verification work.

Twenty measured captures per engine/project; no warm-up samples were discarded. Percentiles use the sorted 10th, 19th and 20th samples (p50/p95/p99). With only 20 samples, p99 is the observed maximum, not a reliable tail estimate.

### Current complex-pixel synthetic fixture

| Engine/profile | p50 ms | p95 ms | p99 ms | PNG bytes |
| --- | ---: | ---: | ---: | ---: |
| Chromium desktop | 33.2 | 34.1 | 34.8 | 89,188 |
| WebKit desktop | 51.0 | 95.0 | 117.0 | 51,721 |
| Pixel 7 emulation | 33.3 | 36.0 | 38.0 | 89,188 |
| iPhone 13 emulation | 48.0 | 54.0 | 104.0 | 51,721 |

Chromium reported no long-task entries during these short samples. WebKit does not support the same `longtask` observer; its empty array must not be read as zero long tasks. This evidence does not establish the proposed hardware SLO or general throughput.

### Exact historical baseline, same simple scene

The benchmark compiles the actual capture implementation from commit `af652fe47b9f56ed8910b50aab0f1367645bd770`. Old and current calls alternate on the same light, two-canvas fixture with no manual overlay. Both outputs decode to identical pixels in each engine. Kepler schema serialization is isolated in both bundles because it is not part of the measured capture call.

| Engine/profile | Old p50/p95/p99 ms | Current p50/p95/p99 ms |
| --- | --- | --- |
| Chromium desktop | 41.8 / 54.9 / 60.2 | 24.5 / 25.5 / 42.0 |
| WebKit desktop | 98.0 / 124.0 / 149.0 | 39.0 / 54.0 / 58.0 |
| Pixel 7 emulation | 42.0 / 45.0 / 51.6 | 23.9 / 26.9 / 30.1 |
| iPhone 13 emulation | 91.0 / 93.0 / 169.0 | 39.0 / 43.0 / 44.0 |

The old path performed 60 PNG encodes in 20 captures; the new path performed 20. The figures qualify only this controlled, pixel-equivalent fixture. They are not an app-wide speedup claim, a large-data/GPU benchmark, or a physical-mobile measurement. When a shallow CI checkout lacks the historical commit, only this baseline test is explicitly skipped.

## Existing framing policy

Canvas composition preserves the existing independent X/Y normalization to 960×540. It does not preserve geometric shape when the editor aspect ratio differs from 16:9: a circle can become an ellipse. The html2canvas fallback separately retains its existing centered 16:9 crop. No crop/contain redesign is included.

Eight additional characterization cases passed across the four working profiles, using actual 1216×720 desktop and 390×844 portrait source pixels. A 120px source circle becomes approximately 95×90px and 295×77px respectively. Every case matches the historical implementation pixel-for-pixel after that normalization. See [the exact dimensions and results](framing-characterization.json). The mounted 0-RGBA comparison below proves this legacy-normalized composition, not geometric fidelity across arbitrary device ratios.

## Mounted renderer follow-up

The real compiled Kepler editor subsequently passed eight unchanged local HTTP/PNG publication cases across Chromium and WebKit. The actual uploaded PNG has zero differing RGBA channel values against its mounted basemap+Deck composition. See [the follow-up report](mounted-kepler-validation.md), [uploaded PNG](mounted-project-preview.png), [viewport screenshot](mounted-editor-viewport.png), and [comparison record](mounted-pixel-comparison.json). The earlier five-flag build passed 28 combined mounted cases. After the consumed-clustering correction, the frozen six-flag build passed 30/30 (ten JSON/PNG cases and 20 panel regressions), including a clustering-only UI edit with unchanged native config/datasets and different decoded PNG pixels.

## Remaining limits

- Firefox was attempted after restoring local dependencies but failed before the first capture test with `RenderCompositorSWGL failed mapping default framebuffer` and a bounded launch timeout. No Firefox result is claimed. The config retains Firefox for a working CI/browser environment.
- No real authenticated account, remote service, real tile/font network failure, real device, vendor GPU matrix, complete mounted Kepler layer matrix, or Production test was performed here.
- CSS/DOM fallback and native canvases can differ across engines. `faithful-light.png` and `faithful-dark.png` are the inspected Chromium PNGs; decoded intra-engine comparisons are the acceptance oracle, not cross-engine encoded-byte equality.
- Offscreen worker composition/encoding is not introduced. The existing WebGL `preserveDrawingBuffer` patch remains intact until the complete supported renderer matrix proves it can change safely.
- A custom/unregistered visible canvas cannot be attributed to the saved state and therefore fails closed. This needs explicit renderer registration before capture support can be claimed.

## Reproduce

- `node --experimental-strip-types --test tests/project-thumbnail-capture.test.mjs tests/map-visual-readiness.test.mjs`
- `npx playwright test --config=playwright.thumbnail-capture.config.ts`

No Vite or authenticated application server is needed. The suite bundles local TypeScript with esbuild, uses synthetic canvas/map data, and intercepts all external requests. Blob URLs created by the fixture are allowed for PNG decode. On machines that need it, the config supports `PLAYWRIGHT_CHROMIUM_EXECUTABLE` and `PLAYWRIGHT_WEBKIT_EXECUTABLE`; use an installed official browser and its supported dependency setup. `PREVIEW_CAPTURE_RESULTS` selects an artifact directory.
