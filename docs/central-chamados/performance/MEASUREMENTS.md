# Measured results

**Historical measurement correction:** `direct-first-authorized-kanban` and `list-to-kanban-first` below used a selector that could match a skeleton. They are retained as raw historical observations but withdrawn as evidence of useful authorized content. Consult `IMMUTABLE-MEASUREMENTS.md` for the corrected, separately built UI comparison when available. Backend, detail and four-page completion use other criteria and are not withdrawn by this selector finding.

Original paired code: f4a49ea5098ce1cbbbab6468c5e7496fcb781c4f; backend baseline: 381c93256d985b0ae39722128fc4ad54f17f025f. Focus follow-up: 118fdc264ca6ae41e069578bcc6d4828de8f758f. Chromium: 140.0.7339.16. All times below are milliseconds. See README for scope/overhead and unavailable fields.

Acceptance remains incomplete: 4/48 backend conditions and 2/40 UI conditions show more than 10% p95 regression. The 30% UI reduction target is not demonstrated across conditions. These are observed local results, not remote D1 measurements.

## Backend — 30 measured requests per side in every row

| Tickets | Flow | Profile | Scenario | p50 before → after | p95 before → after | p95 change | Median bindings before → after |
|---:|:---:|---|---|---:|---:|---:|---:|
| 80 | OFF | owner | list-first | 15.26 → 12.48 | 28.63 → 22.72 | -20.6% | 81 → 47 |
| 80 | OFF | owner | list-reuse | 13.50 → 11.45 | 19.90 → 15.95 | -19.8% | 81 → 47 |
| 80 | OFF | owner | queue-reuse | 13.76 → 11.26 | 22.36 → 17.61 | -21.3% | 81 → 47 |
| 80 | OFF | owner | queue-page2 | 13.37 → 11.75 | 22.69 → 16.65 | -26.7% | 81 → 47 |
| 80 | OFF | owner | filter-new | 14.34 → 12.86 | 28.33 → 24.13 | -14.8% | 81 → 47 |
| 80 | OFF | owner | detail | 18.45 → 14.11 | 35.24 → 27.81 | -21.1% | 174 → 85 |
| 80 | OFF | viewer | list-first | 11.93 → 10.48 | 16.60 → 19.87 | 19.7% | 81 → 47 |
| 80 | OFF | viewer | list-reuse | 14.27 → 11.32 | 22.51 → 19.00 | -15.6% | 81 → 47 |
| 80 | OFF | viewer | queue-reuse | 13.35 → 11.25 | 21.63 → 19.19 | -11.3% | 81 → 47 |
| 80 | OFF | viewer | queue-page2 | 11.86 → 10.91 | 17.42 → 14.77 | -15.2% | 81 → 47 |
| 80 | OFF | viewer | filter-new | 12.76 → 11.51 | 17.03 → 15.70 | -7.8% | 81 → 47 |
| 80 | OFF | viewer | detail | 16.37 → 12.93 | 25.70 → 25.03 | -2.6% | 171 → 82 |
| 80 | ON | owner | list-first | 18.97 → 17.90 | 28.06 → 24.26 | -13.5% | 97 → 56 |
| 80 | ON | owner | list-reuse | 16.14 → 15.28 | 25.86 → 22.99 | -11.1% | 96 → 55 |
| 80 | ON | owner | queue-reuse | 13.22 → 11.27 | 18.60 → 18.88 | 1.5% | 96 → 55 |
| 80 | ON | owner | queue-page2 | 11.63 → 9.35 | 23.76 → 16.88 | -28.9% | 96 → 55 |
| 80 | ON | owner | filter-new | 14.75 → 12.78 | 28.81 → 23.93 | -16.9% | 97 → 56 |
| 80 | ON | owner | detail | 14.94 → 11.36 | 24.59 → 19.40 | -21.1% | 174 → 85 |
| 80 | ON | viewer | list-first | 14.83 → 12.47 | 25.94 → 22.04 | -15.0% | 97 → 56 |
| 80 | ON | viewer | list-reuse | 13.30 → 11.42 | 21.80 → 20.30 | -6.9% | 96 → 55 |
| 80 | ON | viewer | queue-reuse | 14.65 → 12.48 | 29.41 → 27.35 | -7.0% | 96 → 55 |
| 80 | ON | viewer | queue-page2 | 12.64 → 12.13 | 25.10 → 16.70 | -33.5% | 96 → 55 |
| 80 | ON | viewer | filter-new | 18.06 → 16.15 | 27.93 → 25.22 | -9.7% | 97 → 56 |
| 80 | ON | viewer | detail | 13.86 → 9.86 | 22.05 → 20.78 | -5.8% | 171 → 82 |
| 800 | OFF | owner | list-first | 14.00 → 13.48 | 23.44 → 30.78 | 31.3% | 81 → 47 |
| 800 | OFF | owner | list-reuse | 13.07 → 11.52 | 15.46 → 16.69 | 7.9% | 81 → 47 |
| 800 | OFF | owner | queue-reuse | 12.32 → 10.92 | 19.17 → 16.67 | -13.0% | 81 → 47 |
| 800 | OFF | owner | queue-page2 | 13.33 → 11.55 | 19.31 → 16.89 | -12.6% | 81 → 47 |
| 800 | OFF | owner | filter-new | 15.88 → 15.10 | 25.28 → 26.61 | 5.3% | 81 → 47 |
| 800 | OFF | owner | detail | 14.72 → 11.10 | 23.72 → 19.97 | -15.8% | 174 → 85 |
| 800 | OFF | viewer | list-first | 13.23 → 11.75 | 25.07 → 17.46 | -30.4% | 81 → 47 |
| 800 | OFF | viewer | list-reuse | 13.52 → 13.31 | 22.49 → 21.71 | -3.5% | 81 → 47 |
| 800 | OFF | viewer | queue-reuse | 12.60 → 11.09 | 19.25 → 15.46 | -19.7% | 81 → 47 |
| 800 | OFF | viewer | queue-page2 | 12.71 → 11.27 | 20.96 → 16.97 | -19.1% | 81 → 47 |
| 800 | OFF | viewer | filter-new | 15.92 → 14.36 | 19.24 → 21.47 | 11.6% | 81 → 47 |
| 800 | OFF | viewer | detail | 19.45 → 13.14 | 26.22 → 18.02 | -31.3% | 171 → 82 |
| 800 | ON | owner | list-first | 24.26 → 23.15 | 30.09 → 33.54 | 11.5% | 97 → 56 |
| 800 | ON | owner | list-reuse | 15.76 → 13.38 | 23.01 → 19.25 | -16.3% | 96 → 55 |
| 800 | ON | owner | queue-reuse | 16.35 → 14.39 | 23.72 → 24.00 | 1.2% | 96 → 55 |
| 800 | ON | owner | queue-page2 | 16.71 → 14.19 | 30.61 → 25.46 | -16.8% | 96 → 55 |
| 800 | ON | owner | filter-new | 28.46 → 22.13 | 43.83 → 34.08 | -22.2% | 97 → 56 |
| 800 | ON | owner | detail | 23.68 → 17.95 | 30.86 → 23.73 | -23.1% | 174 → 85 |
| 800 | ON | viewer | list-first | 24.49 → 22.79 | 61.20 → 33.70 | -44.9% | 97 → 56 |
| 800 | ON | viewer | list-reuse | 19.04 → 17.00 | 30.99 → 24.04 | -22.4% | 96 → 55 |
| 800 | ON | viewer | queue-reuse | 16.83 → 16.00 | 25.07 → 23.43 | -6.6% | 96 → 55 |
| 800 | ON | viewer | queue-page2 | 15.41 → 13.33 | 21.50 → 21.00 | -2.3% | 96 → 55 |
| 800 | ON | viewer | filter-new | 27.04 → 22.10 | 41.40 → 30.34 | -26.7% | 97 → 56 |
| 800 | ON | viewer | detail | 15.77 → 11.58 | 34.94 → 25.90 | -25.9% | 171 → 82 |

## Browser — 30 measured journeys per side in every row

| Tickets | Flow | Milestone | p50 before → after | p95 before → after | p95 change |
|---:|:---:|---|---:|---:|---:|
| 80 | OFF | direct-first-authorized-kanban | 429.30 → 424.24 | 481.66 → 495.03 | 2.8% |
| 80 | OFF | direct-four-first-pages | 608.70 → 601.50 | 664.25 → 666.99 | 0.4% |
| 80 | OFF | list-to-kanban-first | 259.15 → 252.60 | 307.36 → 299.16 | -2.7% |
| 80 | OFF | list-to-kanban-four | 359.97 → 353.16 | 410.39 → 409.47 | -0.2% |
| 80 | OFF | detail-first-authorized-summary | 394.67 → 410.15 | 454.22 → 455.88 | 0.4% |
| 80 | OFF | detail-reopen-authorized-summary | 379.90 → 365.11 | 408.80 → 411.54 | 0.7% |
| 80 | OFF | rapid-switch-final-summary | 688.60 → 672.22 | 734.94 → 810.88 | 10.3% |
| 80 | OFF | column-pagination | 139.01 → 131.87 | 166.36 → 174.84 | 5.1% |
| 80 | OFF | filter-authorized-kanban | 470.09 → 465.59 | 509.70 → 519.35 | 1.9% |
| 80 | OFF | refresh-with-draft | 194.72 → 206.70 | 250.19 → 276.52 | 10.5% |
| 80 | ON | direct-first-authorized-kanban | 443.30 → 425.26 | 519.80 → 518.14 | -0.3% |
| 80 | ON | direct-four-first-pages | 618.46 → 619.66 | 671.84 → 690.12 | 2.7% |
| 80 | ON | list-to-kanban-first | 257.34 → 257.00 | 327.71 → 289.10 | -11.8% |
| 80 | ON | list-to-kanban-four | 333.10 → 356.86 | 411.78 → 401.81 | -2.4% |
| 80 | ON | detail-first-authorized-summary | 441.25 → 409.83 | 494.07 → 456.36 | -7.6% |
| 80 | ON | detail-reopen-authorized-summary | 373.47 → 371.95 | 420.82 → 409.04 | -2.8% |
| 80 | ON | rapid-switch-final-summary | 671.65 → 671.02 | 748.49 → 785.39 | 4.9% |
| 80 | ON | column-pagination | 141.25 → 124.54 | 180.01 → 193.69 | 7.6% |
| 80 | ON | filter-authorized-kanban | 484.38 → 470.65 | 527.33 → 498.94 | -5.4% |
| 80 | ON | refresh-with-draft | 206.54 → 207.05 | 269.44 → 260.81 | -3.2% |
| 800 | OFF | direct-first-authorized-kanban | 424.69 → 435.95 | 512.28 → 486.19 | -5.1% |
| 800 | OFF | direct-four-first-pages | 663.62 → 665.16 | 743.14 → 748.59 | 0.7% |
| 800 | OFF | list-to-kanban-first | 269.56 → 269.91 | 315.34 → 312.11 | -1.0% |
| 800 | OFF | list-to-kanban-four | 449.36 → 446.86 | 487.29 → 510.47 | 4.8% |
| 800 | OFF | detail-first-authorized-summary | 416.92 → 415.53 | 448.53 → 469.72 | 4.7% |
| 800 | OFF | detail-reopen-authorized-summary | 400.61 → 398.39 | 430.79 → 435.45 | 1.1% |
| 800 | OFF | rapid-switch-final-summary | 799.35 → 761.03 | 872.62 → 860.79 | -1.4% |
| 800 | OFF | column-pagination | 203.26 → 202.08 | 260.60 → 282.35 | 8.3% |
| 800 | OFF | filter-authorized-kanban | 622.34 → 615.55 | 678.52 → 673.99 | -0.7% |
| 800 | OFF | refresh-with-draft | 405.53 → 378.85 | 470.17 → 495.99 | 5.5% |
| 800 | ON | direct-first-authorized-kanban | 440.58 → 432.92 | 506.06 → 523.43 | 3.4% |
| 800 | ON | direct-four-first-pages | 669.32 → 666.16 | 742.84 → 759.63 | 2.3% |
| 800 | ON | list-to-kanban-first | 287.63 → 254.54 | 324.08 → 298.09 | -8.0% |
| 800 | ON | list-to-kanban-four | 425.37 → 413.92 | 522.74 → 484.51 | -7.3% |
| 800 | ON | detail-first-authorized-summary | 424.76 → 420.15 | 488.04 → 525.40 | 7.7% |
| 800 | ON | detail-reopen-authorized-summary | 399.56 → 397.50 | 440.19 → 442.85 | 0.6% |
| 800 | ON | rapid-switch-final-summary | 783.48 → 798.44 | 898.17 → 879.62 | -2.1% |
| 800 | ON | column-pagination | 228.69 → 229.96 | 297.75 → 263.36 | -11.5% |
| 800 | ON | filter-authorized-kanban | 643.43 → 635.27 | 676.12 → 702.37 | 3.9% |
| 800 | ON | refresh-with-draft | 384.83 → 400.41 | 472.77 → 490.26 | 3.7% |

All original journeys preserved the date draft. All original journeys lost refresh-button focus in both variants; this is an existing defect, not a schema regression. Route/page errors were zero; client-side aborts were not captured in that run.

## Focus correction follow-up

120 measured refresh journeys plus four excluded warm-ups passed draft and focus assertions. This shorter journey exercises the targeted correction after rebuilding. It is not substituted for the original paired performance run and has no claimed speed-up.

| Tickets | Flow | n | Refresh p50 | Refresh p95 |
|---:|:---:|---:|---:|---:|
| 80 | OFF | 30 | 333.11 | 415.63 |
| 80 | ON | 30 | 341.14 | 439.51 |
| 800 | OFF | 30 | 443.66 | 537.59 |
| 800 | ON | 30 | 471.53 | 538.49 |

The compact browser summaries include request counts, JSON-body bytes, binding totals, snapshot counts, React commit durations and total render time per journey. Profiler timings include profiling overhead; the optional APIs are disabled fixtures, so their completion does not establish actual secondary-module latency.

## Waterfalls

CSV files select iteration 0 (the first measured iteration after excluded warm-up), fixed without selecting for latency. HTTP rows contain observed start time, duration, kind/page/snapshot reuse/status/bytes; SQL rows contain per-request start time, duration, statement kind, statement count and hashed fingerprint. No payloads or parameters are retained. All original samples are retained in the separate sanitized evidence archive.
