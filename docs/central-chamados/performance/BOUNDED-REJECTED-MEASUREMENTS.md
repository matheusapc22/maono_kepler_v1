# Immutable UI comparison

**Rejected scheduling candidate:** these timings belong to the frozen experimental source below. Delivered product restores scheduling to 13b3a66; do not attribute this table to the final restored product. No loading-duration tuning or further concurrency cycle followed the rejection.

**Observation limitation:** tool connectivity was temporarily unavailable and recovered in the same running session. A separate incident investigation might have used browser panels during 800/flow ON; actual overlap was not established. All samples are retained. See [observation notes](bounded-observation-gap.json); this is not clean-host performance acceptance.

Baseline `381c93256d985b0ae39722128fc4ad54f17f025f`; candidate product `177cc6a95c3220694340cc873575e501536e57ff`; harness `fff045800dee5181c83f3282b211ebf3c9f98bcc`. Each variant serves a separately built, hash-verified UI and frozen handlers. Same Chromium 140.0.7339.16, production React Profiler, 80/800 synthetic tickets, owner, flow OFF/ON, no network/CPU throttle. Thirty alternating pairs per condition; 240 measured journeys, 8 excluded warmups.

Full request lifecycle is recorded for assets and intercepted APIs. Body bytes and Chromium-reported sizes are local observations, not remote wire cost. Original historical comparisons remain separate. No concurrent local tests/builds/benchmarks ran during this comparison.

Runtime failures: 0; request failures/aborts: 0; draft failures: 0; candidate focus failures: 0; baseline focus failures: 120.

| Tickets | Flow | Milestone | Before p50 / p95 ms | After p50 / p95 ms | p95 change |
|---:|:---:|---|---:|---:|---:|
| 80 | OFF | direct-first-authorized-kanban | 795.47 / 973.82 | 759.31 / 907.55 | -6.80% |
| 80 | OFF | direct-four-first-pages | 938.64 / 1013.85 | 932.08 / 955.96 | -5.71% |
| 80 | OFF | list-to-kanban-first | 344.51 / 456.13 | 341.11 / 452.28 | -0.84% |
| 80 | OFF | list-to-kanban-four | 526.48 / 587.47 | 522.65 / 579.40 | -1.37% |
| 80 | OFF | detail-first-authorized-summary | 432.53 / 483.20 | 426.77 / 494.34 | 2.31% |
| 80 | OFF | detail-reopen-authorized-summary | 366.11 / 453.77 | 387.95 / 454.19 | 0.09% |
| 80 | OFF | rapid-switch-final-summary | 884.59 / 972.99 | 923.01 / 1034.18 | 6.29% |
| 80 | OFF | column-pagination | 213.21 / 235.64 | 204.28 / 227.34 | -3.52% |
| 80 | OFF | filter-authorized-kanban | 584.83 / 628.06 | 573.01 / 608.80 | -3.07% |
| 80 | OFF | refresh-with-draft | 280.76 / 364.59 | 284.79 / 314.93 | -13.62% |
| 80 | ON | direct-first-authorized-kanban | 842.85 / 993.49 | 825.23 / 970.39 | -2.33% |
| 80 | ON | direct-four-first-pages | 948.86 / 1026.11 | 950.18 / 1039.17 | 1.27% |
| 80 | ON | list-to-kanban-first | 332.50 / 378.15 | 386.53 / 464.84 | 22.92% |
| 80 | ON | list-to-kanban-four | 515.73 / 585.84 | 529.44 / 578.08 | -1.32% |
| 80 | ON | detail-first-authorized-summary | 432.72 / 483.49 | 424.52 / 460.46 | -4.76% |
| 80 | ON | detail-reopen-authorized-summary | 352.79 / 440.11 | 411.66 / 457.38 | 3.92% |
| 80 | ON | rapid-switch-final-summary | 885.71 / 984.07 | 885.25 / 1035.60 | 5.24% |
| 80 | ON | column-pagination | 214.89 / 239.81 | 204.50 / 223.35 | -6.86% |
| 80 | ON | filter-authorized-kanban | 593.09 / 615.71 | 585.77 / 621.64 | 0.96% |
| 80 | ON | refresh-with-draft | 279.47 / 328.77 | 263.30 / 307.48 | -6.47% |
| 800 | OFF | direct-first-authorized-kanban | 720.64 / 1187.89 | 666.61 / 1082.82 | -8.84% |
| 800 | OFF | direct-four-first-pages | 913.42 / 1291.66 | 855.16 / 1118.08 | -13.44% |
| 800 | OFF | list-to-kanban-first | 335.98 / 670.72 | 345.15 / 666.72 | -0.60% |
| 800 | OFF | list-to-kanban-four | 569.75 / 837.36 | 513.78 / 731.84 | -12.60% |
| 800 | OFF | detail-first-authorized-summary | 419.11 / 486.07 | 412.24 / 462.94 | -4.76% |
| 800 | OFF | detail-reopen-authorized-summary | 388.57 / 450.98 | 388.66 / 424.33 | -5.91% |
| 800 | OFF | rapid-switch-final-summary | 913.37 / 1047.44 | 914.44 / 1133.58 | 8.22% |
| 800 | OFF | column-pagination | 315.27 / 436.60 | 323.71 / 417.06 | -4.48% |
| 800 | OFF | filter-authorized-kanban | 817.54 / 1015.08 | 825.70 / 1011.45 | -0.36% |
| 800 | OFF | refresh-with-draft | 592.92 / 718.49 | 550.01 / 734.60 | 2.24% |
| 800 | ON | direct-first-authorized-kanban | 526.23 / 1108.91 | 481.32 / 946.16 | -14.68% |
| 800 | ON | direct-four-first-pages | 663.53 / 1241.47 | 654.82 / 979.07 | -21.14% |
| 800 | ON | list-to-kanban-first | 318.62 / 442.84 | 321.55 / 480.63 | 8.53% |
| 800 | ON | list-to-kanban-four | 463.15 / 684.01 | 444.24 / 647.61 | -5.32% |
| 800 | ON | detail-first-authorized-summary | 415.36 / 452.24 | 409.32 / 509.76 | 12.72% |
| 800 | ON | detail-reopen-authorized-summary | 394.23 / 459.40 | 405.11 / 445.54 | -3.02% |
| 800 | ON | rapid-switch-final-summary | 902.40 / 1068.44 | 892.42 / 1153.95 | 8.00% |
| 800 | ON | column-pagination | 318.74 / 397.82 | 319.18 / 420.68 | 5.75% |
| 800 | ON | filter-authorized-kanban | 859.79 / 952.08 | 833.20 / 986.44 | 3.61% |
| 800 | ON | refresh-with-draft | 593.68 / 767.76 | 571.19 / 723.31 | -5.79% |

Negative change is faster. Every condition with more than 10% p95 regression remains a failed proposed guardrail, regardless of median or explanatory hypotheses.

| Tickets | Flow | Variant | First detail request p95 ms | Response to visible probe p95 ms | Whole journey React actualDuration p95 ms |
|---:|:---:|---|---:|---:|---:|
| 80 | OFF | before | 61.86 | 293.32 | 776.30 |
| 80 | OFF | after | 29.36 | 301.79 | 782.50 |
| 80 | ON | before | 54.19 | 307.97 | 767.90 |
| 80 | ON | after | 30.03 | 307.06 | 781.10 |
| 800 | OFF | before | 59.82 | 308.82 | 1030.40 |
| 800 | OFF | after | 33.09 | 345.39 | 1043.10 |
| 800 | ON | before | 48.98 | 326.09 | 882.60 |
| 800 | ON | after | 35.47 | 341.26 | 883.90 |

The response-to-visible probe is not an isolated rendering measurement: it includes client handling, existing presentation timing and Playwright observation. The unchanged presentation policy has a 260 ms content deadline; these figures must not be interpreted as permission to shorten it. Optional-module completion, remote D1 latency, full logical backend spans and D1 rows_read/rows_written remain unmeasured.
