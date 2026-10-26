# Ticket Center performance evidence — 2026-10-26

**Measurement correction:** the original browser harness selected `.ticket-kanban-card`, a class also used by skeletons. Its `direct-first-authorized-kanban` and `list-to-kanban-first` timings are withdrawn as evidence of useful authorized content. Historical files remain unchanged for audit. Four-page completion, detail and backend marks use different completion criteria. The separately built UI comparison now requires a visible real ticket subject; results are recorded separately, never substituted into historical tables.

This is an incremental draft PR, not performance acceptance or authorization to deploy. The proven change removes repeated schema introspection inside each ticket GET. It does not cache authorization, sessions, ticket data, or schema across requests. Local measurements do not establish remote D1 latency, and the proposed 30% p95 target is not met across the measured UI conditions.

## Provenance and isolation

- Product baseline: `381c93256d985b0ae39722128fc4ad54f17f025f` on `mano_kepler_v1`.
- Original baseline artifact timestamp: `2026-10-26T19:32:56.036Z`; baseline harness/evidence commit `6282f1c` at 19:34:23 UTC. First behavior-changing commit `daa2654` at 19:43:47 UTC. Baseline was captured before that change.
- Accepted paired backend and original browser comparison: `f4a49ea5098ce1cbbbab6468c5e7496fcb781c4f`. The paired harness loads original route modules from an isolated Git archive of the product baseline. It alternates before/after order within every condition. Both sides use the same current synthetic fixture; the original baseline is retained for provenance, not mixed into paired timing calculations.
- Host: MAÕNO, Windows `10.0.26300` x64, Intel Core i3-N305, 8 logical CPUs, 7.68 GiB RAM, Node `24.15.0`. Separate branch/worktree `perf/ticket-center-baseline`; historical Admin/product worktree left untouched.
- Actual HTTP handlers, SQL, authorization and migrations run only against disposable `node:sqlite` in-memory databases. No production or remote D1 requests, imports, flags, acceptance, migrations, or credentials were used or created. Root `AGENTS.md` boundaries remain in force.
- Browser: headless Chromium, 1440×1000, pt-BR, UTC, service workers blocked, external hosts aborted, no CPU/network throttle or artificial binding latency. The compiled fixture mounts the actual `TicketsSection` with production React profiling. It is a component fixture, not the full application shell. The complete application is separately built and browser-tested in CI.
- Original measured bundle SHA-256: JavaScript `0c00173868304147dad85b5d89a4f60f635a10093805148a3162e1f15f0899cd`; CSS `a438cded57c50c8fc69d29551e3a6cedce279281bfb6503619484745a098a79a`. The later focus correction is rebuilt and checked separately; it is not retrospectively counted as part of this comparison.
- Focus follow-up code: `118fdc264ca6ae41e069578bcc6d4828de8f758f`; JavaScript bundle SHA-256 `495c58fba4794ff7dc8441a449dfc57cc9b30c296fcbc717a9fa9cdc2614f506`, CSS `14b93f03efc6f63211f9f9219a6cbf140b8a94b879fb3d87f8fdbe3bc5c16856`.

## Conditions and interpretation

Backend: 80/800 tickets × flow OFF/ON × owner/viewer × six scenarios × 30 before/after pairs = 2,880 measured requests. One warm-up pair per scenario is retained separately and excluded. `list-first` means a fresh snapshot request in a warm Node process, not a cold Worker. Scenarios: initial list, list snapshot reuse, open queue reuse, queue page 2, new filtered snapshot, and detail.

Browser: 80/800 tickets × flow OFF/ON × 30 before/after journeys = 240 measured journeys, plus eight excluded warm-ups. Every measured journey covers direct saved-Kanban entry, all four first pages, List → Kanban, first detail, reopening, rapid switch, open-column pagination, filtering, and conflict refresh with a draft. Browser profile is owner; backend additionally exercises viewer ACLs. Fresh browser context/database per journey separates first load from reuse within that journey.

Synthetic data includes five statuses, priorities, private tickets, labels, public attachments/events, and a real domain-created internal note/attachment. Full synthetic environment flags are included in `paired-summary.json`; command/triage/selective access/conversation flags are ON, flow varies. Legacy commands-OFF behavior is regression-tested separately, not represented as a measured performance condition. Browser optional-module APIs return disabled envelopes: actual secondary-module completion latency is **not measured**.

Percentiles use the nearest-rank method (p95 is the 29th sorted value for n=30). `elapsedMs` includes the actual handler and response-body consumption. `bytes` is the UTF-8 JSON response body, not compressed wire bytes. Request waterfalls are in observed start order. SQL traces retain only query fingerprints, categories and timing, never SQL text, bindings, cookies, response bodies, messages, or personal data.

Instrumentation overhead is present on both sides: per-binding timers and hashing, Playwright interaction/wait overhead, and the production React Profiler. `bindingMs` is a sum of spans that may overlap, not SQL duration or wall time. SQL `phase` values classify statements heuristically; they are not full logical authorization/schema/snapshot/serialization spans. D1 SQL duration, rows_read, rows_written, cold remote Worker latency and isolated serialization spans are unavailable. Result count is never substituted for rows_read. The original browser run did not capture client-side `requestfailed` events, so client abort counts are unavailable; successful route fulfillment does not prove absence of client aborts. The focused follow-up records them.

The first sequential after-run overlapped dependency installation and is excluded from timing conclusions. Early browser smoke attempts exposed harness selector issues and are excluded. The accepted paired backend and full browser runs do not overlap builds/tests or each other. The Windows host is not a dedicated performance appliance; observed p95 regressions remain reported rather than dismissed as noise.

## Confirmed causes and changes

1. Repeated schema discovery is demonstrated by per-request traces: list requests perform 58–70 schema calls and details 125–126 in the baseline. Request-local memoization reduces those to 24–29 and 36–37 respectively. Total baseline list bindings are 81–97 versus 47–56 after; details 171–174 versus 82–85. Every new HTTP request redoes authorization and observes schema anew. Failed schema reads are evicted; callers receive independent Sets; unscoped routes preserve their previous behavior.
2. A viewer receives one authorized attachment but the original detail counter reports two, while the list reports one. Detail now derives the count from its existing authorized attachment result. This closes a count disclosure/inconsistency and avoids treating hidden content as an ordinary representation difference. No extra SQL, no fabricated card envelope, no ETag or ACL bypass.
3. The baseline and schema patch both lose focus when the conflict-refresh button becomes natively disabled. The focused correction uses `aria-disabled` plus an activation guard, retains disabled styling, and adds keyboard/draft/duplicate-activation coverage. No loading presentation duration is changed.

No new endpoint, index, migration, shared cache, client detail cache, JSON.stringify comparator shortcut, pagination change, or global loading-time adjustment is introduced. Abort/sequence guards, If-Match, locks and version handling are unchanged.

## Kanban ownership and remaining work

The measured request waterfall confirms the general list request still runs alongside queue loading; it supplies assignees, attachment limits, flags and snapshot metadata. Before commit `65ee553`, the board awaited `open` before starting the other three queues even with a valid shared snapshot. That dependency is now removed only when an existing token is available. Each queue still reauthorizes its read. A held-open browser control demonstrated all three siblings ready with the same token, with 401/403/404 invalidation and local 409 errors preserved. With a fresh snapshot, token creation remains a real dependency. The cold control still creates two snapshots (general + open); no metadata responsibility was removed.

Candidate A is a lightweight common initialization owned by TicketsSection, followed by independent queue reads using one validated snapshot. Candidate B is a metadata/first-pages bootstrap response, with later pagination per queue. A has the smaller contract footprint; B changes the endpoint contract and response-size distribution. Neither has been implemented or measured in this incremental patch. A follow-up must prove snapshot owner/query/expiry binding, frozen membership/order and ACL holes, remove redundant general cards only after replacing metadata duties, and retain atomic reconciliation swaps after mutations. No endpoint is justified by the present local timing alone.

Collapsed Metrics, repeated assignee/policy work, legacy-import scans, retained-pin detail reads and full detail comparison remain candidates. No memoization, batching, progressive detail split, virtualization, or lazy panel change is claimed without its own measurement and compatibility evidence. The current patch reduces a proven backend cost but does not eliminate all identified Kanban/detail bottlenecks.

## Validation and rollback

The request-schema tests cover request/database isolation, concurrent reads, caller-owned Sets, failed reads, session/membership/ticket ACL revocation, missing required schema, legacy import idempotence, authorized attachment counts, and exact preservation guards. Existing preservation checks reconstruct the pre-change helper byte-for-byte; unrelated drift still fails. Only the two reviewed API source hashes are updated in the documentation contract.

Local TypeScript, scoped lint, isolated production profiling build, request-schema tests (10), users/password preservation tests (51), and API docs tests (7) passed before the focus follow-up. The broad local suite reported 755/760 passing: five failures are existing Windows-specific POSIX file-mode and `/C:/` URL-path assumptions. No test was skipped, weakened, or rewritten to conceal those failures. The full application build exceeded the local memory budget and was stopped; the full build and Linux gates run in CI. Final-head CI and focus follow-up results are recorded in the delivery evidence, not inferred from earlier heads.

At the focus-correction commit, TypeScript and scoped lint passed again, the isolated profiling build completed in 3.03 seconds, and 108 focused tests passed with zero skips. These include the original page/style/selector preservation contracts and negative controls for the exact focus/style inverse. Independent technical review found no blocker in the request-scoped schema or focus changes; it did not substitute for executed tests. All nine workflows on the original measured `f4a49ea` head passed, including the full application build and Central visual suite; that is historical evidence, not final-head status.

Rollback: revert the request-scoped schema wiring/helper, authorized attachment-count change, and focused UI correction as normal code changes. No database schema/data migration or feature-flag operation is required. Do not revert authorization behavior independently or treat flag OFF as a confidentiality rollback. This PR remains a draft; no merge, Preview deployment, production acceptance or rollout is authorized by these results.

## Reproduction

1. Install the repository's existing dependencies and supported Playwright Chromium in an isolated checkout. Do not copy `.env`, `.dev.vars`, browser sessions or production datasets.
2. Run `node scripts/central-chamados/prepare-performance-baseline.mjs` to extract only versioned baseline route code.
3. Run `node scripts/central-chamados/benchmark-paired.mjs` for the alternating backend comparison.
4. Build `node node_modules/vite/bin/vite.js build --config vite.ticket-performance.config.ts`, serve the output on localhost port 4178, then run `node scripts/central-chamados/benchmark-browser.mjs`. Set `PLAYWRIGHT_BROWSERS_PATH` to the installed browser directory when the Windows sandbox account has a different profile.
5. For the focused post-correction repeat, rebuild and use `PERF_REFRESH_ONLY=1`; this is a follow-up correctness/draft-focus measurement, not a replacement for the original paired comparison. Keep each run's SHA/bundle and raw artifact.

See the generated measurement tables, compact JSON summaries, and sanitized request/SQL waterfalls alongside this report. Raw artifacts are packaged separately because they are too large for source control. Library delivery is subject to the tool result; no Library ID or private URL is fabricated.

- [Full p50/p95 tables](MEASUREMENTS.md)
- [Kanban request waterfall chart](kanban-waterfall.svg)
- [HTTP waterfall data](http-waterfall.csv) and [SQL/binding waterfall data](sql-waterfall.csv)

## Acceptance status

The local evidence supports reduced per-request schema/binding work, the attachment-count correctness fix and independent queues with an existing snapshot. It does **not** establish complete acceptance: first-content timing needs the corrected UI comparison, some critical p95 conditions regress more than 10%, remote D1 and real optional-module completion are unmeasured, full logical backend spans are absent, and original-browser client abort counts are unavailable. Cold snapshot initialization/general-card duplication remain unchanged. A merge or rollout decision must not reinterpret this draft as those criteria having passed.
