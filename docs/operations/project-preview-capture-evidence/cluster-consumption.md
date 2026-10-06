# Consumed clustering policy: follow-up regression

## Reproduced at `b88af44`

The real point-clustering store changed from disabled/size 40 to enabled/size 120. A save-generation subscription counter incremented and the saved Maono extension changed, while the native Redux input references and camera remained identical. A deliberately delayed renderer kept acknowledging its old Deck layer array. The complete capture barrier nevertheless accepted that old frame.

The baseline used real policy-store and capture-barrier modules, a subscription counter for the save generation, and synthetic map/Deck runtimes. It was **not** a mounted-editor reproduction. Its recorded result was:

- `editGeneration`: 1
- `nativeInputsUnchanged`: true
- `oldLayerArrayAcknowledgedForNewSave`: true
- `oldFramePassedFullCaptureBarrier`: true

The gap was outside the existing native-state witness: adaptive Point and GeoJSON layers read the external clustering policy during `renderLayer`. A same-zoom render request does not prove that the corresponding policy or aggregate data was consumed.

## Required invariant

Capture must compare the saved Maono extension with immutable policy/source provenance belonging to the actual Deck layers. Clustered layers additionally require a witness for the materialized aggregate result. Reusing an old layer, transferring old composite state, or redrawing an old callback must not relabel those pixels with a newer requested policy. The materialization identity is frozen at the actual after-render acknowledgment; a later update cannot retroactively authorize an older drawn frame.

An empty native layer-data array alone does not establish that the saved dataset is empty. A review counterexample retained three saved rows while exposing an empty intermediate native array. Any empty-dataset exception must require positive evidence from the corresponding immutable saved dataset as well as the native consumer. Unknown, ambiguous or nonempty saved data keeps the frame pending.

The installed Kepler packages are 3.2.0 and Deck core is 8.9.27. Their CPU aggregation path is synchronous: a data change rebuilds GeoJSON and its ClusterBuilder before producing aggregate layer data. Both adaptive Maono paths prepare a new filtered source array. A narrow witness after that existing update can identify the consumed input and materialized result; a new clustering algorithm or cache is unnecessary.

## Equivalent-path inspection

Both adaptive Point and GeoJSON paths are in scope. Persisted pins and buffers enter through native Redux datasets/layers, already covered by the native witness. Temporary pin/buffer/geometry overlays are excluded from the preview. No other saved Maono passthrough extension was found to have a rendering consumer outside that protected state.

## Frozen-source verification

- The focused Node gate passed 50/50 checks, including real adaptive Point/GeoJSON classes and the installed CPUAggregator/ClusterBuilder. Only GPU plumbing is substituted in those Node tests.
- Independent reviewers reran 50/50 and 43/43 focused checks and reported no remaining source blocker in the examined paths.
- The complete browser capture matrix passed 104/104 cases across Chromium/WebKit desktop and mobile emulation. This includes the previous 96 cases and eight new real-Deck cases.
- The new browser cases hold a policy change with unchanged native references/camera, redraw the old frame, and require capture to remain pending. They then construct, aggregate and draw the matching frame through actual Deck/onAfterRender before permitting capture. Enable/size120, count labels, size40, disable, Point/GeoJSON and last-layer cleanup are covered.
- These isolated Deck cases use synthetic source data/basemap and an isolated serializer; the compiled mounted-app gate separately covers the actual Kepler serializer and UI.
- A 16-case repeat persisted the current benchmark and real-Deck evidence without failures or skips.

The frozen six-flag build passed TypeScript and Vite (1m15s). Its compiled mounted-app gate then passed 30/30 Chromium/WebKit cases without skips, including a clustering-only UI edit that preserves native config/datasets and changes decoded PNG pixels in both engines. The deterministic old-frame/cache regressions above provide the race proof; the mounted case proves normal end-to-end rendering/publication. The full repository suite passed 2783/2783 and the complete card/IndexedDB browser gate passed 92/92. The strict error-copy ratchet passed. New/changed code adds no lint findings; global lint retains 109 errors/53 warnings, including the existing adaptive-layer @ts-nocheck error. A newly added suppression comment was removed after the build; byte-identical emitted JavaScript was verified and recorded in measurements.json. No production account, migration, deployment or data repair is part of this local validation.
