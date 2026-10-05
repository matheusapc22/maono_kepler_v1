# Project thumbnail identity and failure states

## Scope

The follow-up authorized a focused thumbnail backend fix in addition to the
ProjectCard presentation fix. It does not change permissions, map capture,
production flags, schemas, dependencies, or the initial 80/260 ms Skeleton policy.
No production data, Dropbox files, migrations, merge, or deployment were operated
during this investigation or local validation.

## Reproduced causes

1. `UNKNOWN` plus any image error previously rendered “Sem prévia”. An image's
   error event cannot distinguish missing bytes from 401/403, a provider outage,
   connection failure, or invalid image data.
2. A legacy lifecycle backfill can advance `config_revision` while the PNG is
   still the canonical `config.kepler.png`. Reading that PNG previously marked
   it `READY` at the positive config revision. The next uncached request looked
   for `config.kepler.rN.png`, received not-found, and marked it `MISSING`, even
   though the canonical PNG still existed.
3. A delayed not-found for revision N compared only `preview_status`. It could
   mark a newly published revision N+1 `MISSING` after the old file was cleaned up.
4. `FAILED` retained the previous preview revision, but the binary endpoint
   refused to serve it. The card's existing previous-image fallback could work
   from cache yet fail in a fresh browser session.

These were present before the recent Skeleton commits. The initial diagnosis used
the pre-fix compiled React application with controlled HTTP fixtures and the
complete endpoint bodies with real preview helpers, SQLite and local storage.
Session, permission and audit boundaries are substituted in the endpoint fixture;
this is not an authenticated end-to-end production test.

## Identity and concurrency rules

- Revision `0` identifies the canonical legacy PNG. Positive revisions identify
  only their actual `.rN.png` files. `null`, `undefined` and empty values do not
  establish a previous preview.
- `UNKNOWN` cards request `?v=0`; config revision is never borrowed as the legacy
  image's identity. Explicit thumbnail URLs remain unchanged.
- Legacy reconciliation records `READY/0`, conditioned on the observed status,
  config revision and preview revision. An old reader cannot overwrite a newer
  generation. Concurrent readers of the same canonical PNG remain supported.
- An older client requesting an `UNKNOWN` legacy PNG with a positive `v` gets a
  revision-mismatch response after metadata reconciliation, without canonical
  bytes being cached under that positive revision.
- Missing-file updates use the same complete snapshot comparison. A failed
  previous-image read does not replace the newer `FAILED` generation state.
- `FAILED` serves a previous PNG only for an explicit request matching the
  persisted previous revision. Existing authentication, project authorization and
  permission checks run before storage access.
- Only the provider's specific path-not-found code with its expected 404/409
  status establishes absence. Message substrings cannot convert 401/403/429/5xx
  failures into `MISSING`.
- Unversioned reads use `no-store`; correctly versioned images keep the existing
  private immutable cache. GET does not copy, upload or rename image files.

## Equivalent locations adjusted

- `project-preview-presentation.mjs`: unknown load failures use the existing
  “Prévia indisponível” state. Confirmed `MISSING` retains “Sem prévia”.
- `project-card-utils.ts`: canonical identity and null/zero distinction. The
  shared component covers Todos os Projetos, Recentes and Favoritos.
- `project-preview.js`: revision normalization and guarded READY/MISSING writes.
- Thumbnail binary endpoint: canonical identity, failed-generation previous
  image serving, snapshot-safe not-found handling and unversioned cache policy.
- Existing administrative preview reconciler: the same canonical identity and
  guards, with counters reflecting successful transitions only.
- Previous-image cleanup: revision zero selects the canonical filename.

## Existing affected records

This code prevents new occurrences. It does not claim that real affected
projects have recovered. Existing `MISSING` rows, or historical `READY/rN` rows
incorrectly associated with a legacy PNG, require a separate scoped investigation
and explicitly authorized repair. A status refetch alone does not inspect storage;
adding a retry button would not resolve this state.

Safe repair preparation is read-only: identify the exact project/organization,
snapshot its current config/preview metadata, and verify which canonical or
revisioned file actually exists. Any later authorized metadata correction must
use those exact identities and compare-and-swap conditions. A legacy PNG must
never be represented as a newer generated image. No generic fallback, bulk
repair or storage rewrite has been added here.

## Regression coverage

- New backend suite executes both full endpoint bodies with real SQLite/local
  storage. Initial RED run reproduced 12 failures; final coverage includes
  repeated legacy loads, lifecycle backfill, concurrent readers, changed config,
  changed preview at the same config, state changes, previous-image serving,
  cleanup, authorization, transient storage errors and the explicit repair limit.
- Frontend coverage distinguishes UNKNOWN load failure from confirmed absence,
  canonical zero from missing revision, and preserves explicit URLs. Browser
  cases exercise all three Projects tabs and valid/invalid image responses.
- Historical Project Pages hashes remain unchanged. An exact inverse records
  only the newly authorized thumbnail edits; canaries reject unrelated access,
  identity and failure-policy changes rather than accepting new baselines.
- The new endpoint suite is included in `test:project-preview`, the aggregate
  suite and the Project Pages CI gate.

### Validation status when published

- Aggregate Node suite: **2,544/2,544**; typecheck, scoped lint, strict error-sink
  ratchet and diff checks passed. Independent code review found no introduced
  blocking issue.
- The full local Vite build could not complete within this execution environment's
  available memory. Reduced heaps exhausted V8; larger heaps were terminated by
  the environment during chunk generation. No project build configuration was
  changed to hide this limit.
- The final compiled browser gate remains required in CI. Local development-mode
  browser checks passed **27/27** (nine scenarios in Chromium, Firefox and WebKit)
  and are not counted as compiled passes.
  Their temporary test copy allows React development StrictMode's repeated GET;
  the committed compiled tests retain their exact single-request assertions.
