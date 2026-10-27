# Consolidated draft delivery

The delivered change reduces proven per-request schema work, corrects the authorized attachment count and preserves refresh-button focus with an active draft. **It does not demonstrate the proposed 30% UI p95 improvement or complete performance acceptance. Both experimental Kanban scheduling changes are rejected and reverted.**

Product baseline is `381c93256d985b0ae39722128fc4ad54f17f025f`. Rollback commit `62fbb462225cd01040455c1b8de3bd9a4369498b` restores `src/`, `functions/` and `tests/` byte-for-byte to `13b3a66ae499f384f5ba89e33cbb3334dc700c24`. Backend source also equals the measured `f4a49ea5098ce1cbbbab6468c5e7496fcb781c4f`. The final evidence commit changes reports/tooling only. Exact equivalence, files and checks are recorded in [delivery-checkpoint.json](delivery-checkpoint.json).

## Retained patch

| Proven cost | Before | After |
|---|---:|---:|
| Total bindings, initial list | 81–97 | 47–56 |
| Schema reads, list paths | 58–70 | 24–29 |
| Total bindings, detail | 171–174 | 82–85 |
| Schema reads, detail | 125–126 | 36–37 |

These are actual local binding-call counts, not D1 rows_read or SQL duration. Request-local memoization covers schema introspection only, evicts failed promises and returns caller-owned Sets. Every request reauthorizes access and observes schema again. No ticket, session, ACL or organization-access cache is shared between requests.

A viewer previously received one authorized attachment while the detail counter exposed two. The detail now counts its existing authorized result, matching the list. The focused UI fix uses aria-disabled plus an activation guard to retain focus during conflict refresh, preserving draft, If-Match and disabled appearance. No global presentation duration changed.

Eight product files change: the request-schema helper, organization schema helpers, ticket-center count, two GET routes, TicketDetailDrawer and its two scoped CSS files. No Board scheduling change, new endpoint, migration, index, persistent credential, client detail cache or broad rewrite remains.

## Measurement provenance and decisions

Baseline data was captured at 19:32:56 UTC, before the first behavior patch at 19:43:47 UTC. Synthetic SQLite databases and actual handlers ran locally on MAONO. Browser runs use Chromium 140.0.7339.16, production React Profiler, 1440×1000, pt-BR/UTC, no CPU/network throttle and blocked external hosts. Instrumentation and Playwright observation overhead are included on both sides. The later comparisons use separately built immutable UI/handler archives, with source and asset hashes verified before and after execution.

| Experiment | Measured scope | Outcome |
|---|---|---|
| Original backend, f4a49ea | 48 conditions × 30 alternating pairs; owner/viewer, 80/800, flow OFF/ON | Binding reduction confirmed; four p95 regressions >10% retained |
| Confirmatory backend, fb76f0e; same backend source | Same 48 × 30 pairs | Original four tails did not repeat >10%; three other tails did; no no-regression acceptance |
| Historical UI, f4a49ea | 240 journeys + 8 warmups | Two first-Kanban marks withdrawn because selector matched skeleton; detail/four-page/backend criteria unaffected |
| Focus follow-up, 118fdc2 | 120 measured refreshes + 4 warmups | Draft/focus preserved, zero recorded request failures; not a speed comparison |
| Four concurrent queues, 65ee553 | 240 journeys + 8 warmups, distinct UI builds | Rejected: four of 40 p95 guardrails failed |
| Same-backend open-first / four / two workers | 180 journeys + 6 warmups, 30 per variant/volume | Two workers passed this narrower p95 guardrail, but worsened first-content medians and did not meet 30% |
| Two workers, 177cc6a | 240 journeys + 8 warmups, distinct UI builds | Rejected: two of 40 p95 guardrails failed; zero execution/request/draft/candidate-focus failures |

The two-worker full journey regressed List-to-Kanban first content at 80/flow ON: **378.15 → 464.84 ms p95 (+22.9%)**. At 800/flow ON, detail summary was **452.24 → 509.76 ms (+12.7%)**. The latter condition also carries a potential external-host-work limitation: a separate incident investigation might have used browser panels; actual overlap was not established. Tool connectivity briefly became unavailable and recovered in the original running session. [Observation notes](bounded-observation-gap.json) preserve these uncertainties. No samples were selectively discarded and no new benchmark was started after rejection.

The delivered restored UI did not receive another complete latency run. Do not attribute either rejected candidate's timing to it. Backend equivalence supports the binding-count result; valid historical detail milestones and the focus correction retain their own source/version scope. Historical first-content values remain withdrawn, including the original chart preserved separately. [Withdrawal scope](withdrawn-metrics.json).

- [Four-worker full table](IMMUTABLE-MEASUREMENTS.md) and [waterfall](immutable-http-waterfall.csv).
- [Causal scheduling table](QUEUE-SAME-BACKEND-V1.md) and [waterfall](queue-same-backend-v1-waterfall.csv).
- [Rejected two-worker full table](BOUNDED-REJECTED-MEASUREMENTS.md) and [waterfall](bounded-rejected-http-waterfall.csv).
- [Historical tables](MEASUREMENTS.md), [confirmatory backend](backend-confirmatory-summary.json) and [detailed diagnosis](README.md).

## Remaining bottleneck and next experiment

Cold initialization demonstrably creates two snapshots: general list plus open queue. The general response also supplies assignees, limits, flags and snapshot metadata, so deleting it would remove responsibilities. A single lightweight initialization (A) could reduce duplicate preparation but also add a dependency before the first card. A metadata/four-page bootstrap (B) changes payload size, error isolation and endpoint contract. Neither safe latency benefit has been demonstrated. The next explicit experiment would instrument common preparation/snapshot spans, then compare A against the current path while preserving owner/org/query/expiry, frozen membership/order, holes and per-read ACL checks. B needs measured justification before extending the endpoint contract.

Detail response-to-visible timing includes client/React work, the unchanged 260 ms presentation deadline and Playwright observation. Whole-journey Profiler totals do not isolate a detail render bottleneck. These data do not justify shortening presentation, adding virtualization or fabricating a detail envelope from a card. Optional modules return disabled fixture responses; their real completion latency is unmeasured. Remote D1 latency, rows_read/rows_written and full logical backend spans were unavailable. An isolated remote environment is needed to validate remote effects; production was not used as a substitute.

## Validation and delivery boundaries

After rollback, TypeScript and scoped lint passed. Targeted tests: **60/61 passed, zero skips**. The one failure is the existing Windows URL.pathname/esbuild resolution of the shared footer comparison; its exact body equals the product baseline. The earlier broad local run was 755/760, with the previously documented Windows-specific path/POSIX-mode failures. No gate was weakened. Full local application build had exceeded available memory; final-head Linux CI performs the actual application build and browser checks. The final PR status must be checked after publication, not inferred from an earlier SHA. Independent read-only review confirmed rollback equivalence and found no additional blocker.

The historical checkout remains at `cdc2277774ffe89a944761d5738b40b0d038cb73` with its pre-existing untracked `exports/`; this task uses its dedicated worktree/branch. No merge, direct deploy, DNS change, flags, production acceptance, migration, production GET/benchmark/import, or credential creation/renewal was performed. External actions initiated were branch/PR publication and updates, GitHub/CI reads and development dependency downloads. Automatic PR workflows are separate evidence, not a production action claim.

Rollback of the retained patch is an ordinary code revert; no schema/data migration or flag operation is needed. The PR remains draft and is not merge-ready on performance criteria.

Raw reports remain locally preserved with hashes in the summaries. Library transfer was not completed: automatic approval review denied copying the transfer helper, and the parent explicitly prohibited retries/workarounds. No library_file_id exists. The sanitized reports and waterfalls linked here are the available GitHub deliverables; no private temporary download URL is fabricated.
