# Mounted Kepler capture follow-up

Local synthetic validation on 2026-10-06. This follows the isolated 88-case capture matrix and eight framing characterizations; it does not authorize or report Production acceptance.

## Reproduced failures and corrections

The real compiled React/Kepler editor confirmed JSON revision 2 but produced no preview manifest or PNG upload. Runtime inspection found `CAPTURE_INVALID_CAMERA` before readiness, despite valid, matching camera/Redux/renderer state.

1. Actual `KeplerGlSchema.save` returns `config: {version, config: {mapState, visState, ...}}`. The capture-only metadata reader now unwraps that versioned envelope without changing the serialized JSON. It never substitutes live camera/data for absent saved input. Coverage includes the installed Kepler schema and real initial reducer state, nested and flat saved shapes, and invalid/missing envelopes.
2. The mounted DOM puts Deck's canvas before a basemap canvas nested in an ancestor with `z-index: -1`; both canvases have their own `z-index: auto`. Sorting only the canvas's own z-index would paint the basemap over Deck. Composition now compares ancestor stacking contexts and preserves sibling-context ordering. The regression reproduces that DOM shape and compares all decoded RGBA values.

The strict camera/generation/style/renderer provenance checks remain enabled. Layer-array identity was investigated and was not relaxed.

## Real mounted results

A five-flag production-format local build passed. The integration tests, HTTP fixture, renderer, serializer, capture/encode path, IndexedDB and server PNG validator were unchanged for this run.

Eight cases passed: four in Chromium and four in WebKit:

- JSON receipt → matching PNG manifest/upload, verified checksum and 960×540 size, confirmation updated, same live editor retained
- PNG 503 preserves the confirmed JSON receipt and live editor
- Replacement fencing, concurrent-upload exclusion, historical PNG receipts and stale-revision rejection
- Late historical PNG response cannot replace the newer save's confirmation

A separate read-only pixel comparison of the actual uploaded PNG against the mounted basemap+Deck composition found **zero differing RGBA values after the legacy nonuniform normalization** from 1216×720 to 960×540. This does not claim shape preservation across aspect ratios. Deck contributed 169 differing channel values compared with basemap alone, confirming that the successful upload included rendered layer pixels.

The missing-envelope fail-closed tightening, high-zoom camera-equivalence guard, payload-free callbacks and transactional session/purge fixes were then included in a frozen five-flag build. That mounted rerun passed all 28 cases in Chromium/WebKit: the same eight JSON/PNG cases plus 20 existing map-panel regressions, with no skips (2026-10-06, 5m18s). No source or fixture changed during that run.

## Focused final checks

- 30 Node checks passed across capture and readiness, including actual Kepler serialization.
- Four new Chromium/WebKit checks passed for mounted-like negative-z stacking and removal of the last layer. Removing the last layer still waits for Deck to acknowledge and clear its old frame; capture does not bypass Deck based on an empty saved layer list.
- High-zoom readiness rejects a 0.00009-degree stale pan at zoom 20; camera equivalence is bounded to 0.001 projected world-pixel with Mercator latitude scaling, retains wraparound and permits numerical roundoff.
- Targeted ESLint and whitespace checks passed.

## Consumed clustering follow-up

The subsequent [consumed-policy regression](cluster-consumption.md) exposed an external clustering-policy gap outside the original native-state witness. After the immutable policy/source/materialization fence was corrected, a new six-flag production-format build passed TypeScript and Vite. Clustering is explicitly enabled in this QA build.

The frozen build passed **30/30 mounted cases** across Chromium and WebKit, without skips (2026-10-06, 5.4 minutes): the previous 28 cases and a clustering-only edit in each engine. The new case uses the actual layer-panel controls to enable grouping and set size 120, then saves immediately. It requires the new policy in the saved extension, identical native configuration and datasets, a higher edit generation, and the PNG's exact revision/save-operation/checksum binding. Both uploaded PNGs are decoded; their dimensions must match and their RGBA pixels must differ. The same canvas and editor remain mounted.

This ordinary UI case also passed against the prior build, so it is a normal-flow integration check rather than a reproduction of delayed consumption. The separate deterministic real-Deck tests hold the old frame and prove that the new fence rejects it until matching policy and aggregate data are actually rendered. Neither test substitutes for the other.

The workflow discovers five combined cases in each of Chromium, Firefox and WebKit. Local Firefox execution remains limited as documented; the exact published commit still requires its three-engine CI gate. PNGs are written to the test output directory before attachment so the default reporter and CI artifact collection retain the actual uploaded bytes.

Persisted artifacts:

- [Exact uploaded PNG](mounted-project-preview.png)
- [Mounted editor viewport](mounted-editor-viewport.png), including UI controls that are deliberately outside map-pixel composition
- [Full RGBA comparison result](mounted-pixel-comparison.json)

These tests use local synthetic accounts, map data and service responses. No user data, authenticated external service, production storage, deployment or migration was used. Firefox/physical-device/GPU limitations from the earlier evidence still apply.
