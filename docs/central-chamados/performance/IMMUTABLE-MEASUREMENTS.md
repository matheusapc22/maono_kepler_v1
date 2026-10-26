# Immutable UI comparison

Baseline `381c93256d985b0ae39722128fc4ad54f17f025f`; candidate product `65ee55390b3055c82c9e57cdcd80d981d0fa1eab`; harness `bcb9b18ecb5a390f61115afeaaa4d9d3b87fc3a6`. Each variant serves a separately built, hash-verified UI and frozen handlers. Same Chromium 140.0.7339.16, production React Profiler, 80/800 synthetic tickets, owner, flow OFF/ON, no network/CPU throttle. Thirty alternating pairs per condition; 240 measured journeys, 8 excluded warmups.

Full request lifecycle is recorded for assets and intercepted APIs. Body bytes and Chromium-reported sizes are local observations, not remote wire cost. Original historical comparisons remain separate. No concurrent local tests/builds/benchmarks ran during this comparison.

Runtime failures: 0; request failures/aborts: 0; draft failures: 0; candidate focus failures: 0; baseline focus failures: 120.

| Tickets | Flow | Milestone | Before p50 / p95 ms | After p50 / p95 ms | p95 change |
|---:|:---:|---|---:|---:|---:|
| 80 | OFF | direct-first-authorized-kanban | 627.52 / 735.66 | 633.74 / 744.96 | 1.26% |
| 80 | OFF | direct-four-first-pages | 728.51 / 835.46 | 760.58 / 853.08 | 2.11% |
| 80 | OFF | list-to-kanban-first | 311.46 / 340.04 | 298.01 / 364.14 | 7.09% |
| 80 | OFF | list-to-kanban-four | 448.86 / 502.16 | 422.08 / 475.60 | -5.29% |
| 80 | OFF | detail-first-authorized-summary | 429.06 / 472.98 | 432.26 / 489.00 | 3.39% |
| 80 | OFF | detail-reopen-authorized-summary | 404.56 / 439.66 | 399.34 / 432.74 | -1.58% |
| 80 | OFF | rapid-switch-final-summary | 741.42 / 857.25 | 761.55 / 862.02 | 0.56% |
| 80 | OFF | column-pagination | 175.23 / 205.57 | 161.53 / 202.44 | -1.52% |
| 80 | OFF | filter-authorized-kanban | 522.49 / 559.52 | 514.19 / 566.86 | 1.31% |
| 80 | OFF | refresh-with-draft | 215.35 / 272.27 | 227.71 / 285.16 | 4.73% |
| 80 | ON | direct-first-authorized-kanban | 607.32 / 760.20 | 608.85 / 803.10 | 5.64% |
| 80 | ON | direct-four-first-pages | 737.91 / 874.05 | 742.56 / 883.32 | 1.06% |
| 80 | ON | list-to-kanban-first | 296.91 / 380.17 | 409.84 / 497.37 | 30.83% |
| 80 | ON | list-to-kanban-four | 422.35 / 472.14 | 486.52 / 561.37 | 18.90% |
| 80 | ON | detail-first-authorized-summary | 426.64 / 506.52 | 406.16 / 461.23 | -8.94% |
| 80 | ON | detail-reopen-authorized-summary | 406.80 / 435.74 | 396.06 / 428.75 | -1.60% |
| 80 | ON | rapid-switch-final-summary | 765.81 / 903.69 | 751.93 / 829.12 | -8.25% |
| 80 | ON | column-pagination | 174.57 / 219.93 | 164.24 / 204.82 | -6.87% |
| 80 | ON | filter-authorized-kanban | 530.84 / 574.06 | 530.09 / 585.84 | 2.05% |
| 80 | ON | refresh-with-draft | 224.26 / 280.46 | 192.90 / 225.03 | -19.76% |
| 800 | OFF | direct-first-authorized-kanban | 593.34 / 880.86 | 619.83 / 917.58 | 4.17% |
| 800 | OFF | direct-four-first-pages | 827.40 / 913.20 | 852.50 / 966.46 | 5.83% |
| 800 | OFF | list-to-kanban-first | 316.83 / 376.75 | 305.64 / 358.93 | -4.73% |
| 800 | OFF | list-to-kanban-four | 547.36 / 602.79 | 523.75 / 602.90 | 0.02% |
| 800 | OFF | detail-first-authorized-summary | 395.66 / 469.20 | 389.12 / 435.79 | -7.12% |
| 800 | OFF | detail-reopen-authorized-summary | 368.02 / 431.72 | 363.86 / 434.80 | 0.71% |
| 800 | OFF | rapid-switch-final-summary | 816.73 / 920.24 | 858.11 / 926.10 | 0.64% |
| 800 | OFF | column-pagination | 276.76 / 358.41 | 270.94 / 329.06 | -8.19% |
| 800 | OFF | filter-authorized-kanban | 703.32 / 775.56 | 720.42 / 790.36 | 1.91% |
| 800 | OFF | refresh-with-draft | 471.10 / 544.17 | 449.96 / 571.50 | 5.02% |
| 800 | ON | direct-first-authorized-kanban | 608.00 / 849.17 | 597.07 / 841.60 | -0.89% |
| 800 | ON | direct-four-first-pages | 845.94 / 907.76 | 834.96 / 928.47 | 2.28% |
| 800 | ON | list-to-kanban-first | 334.43 / 541.00 | 600.83 / 689.03 | 27.36% |
| 800 | ON | list-to-kanban-four | 539.68 / 636.57 | 628.79 / 723.34 | 13.63% |
| 800 | ON | detail-first-authorized-summary | 406.08 / 459.45 | 387.42 / 428.42 | -6.75% |
| 800 | ON | detail-reopen-authorized-summary | 368.51 / 445.74 | 368.90 / 470.36 | 5.52% |
| 800 | ON | rapid-switch-final-summary | 845.64 / 973.58 | 842.35 / 947.35 | -2.69% |
| 800 | ON | column-pagination | 276.82 / 347.22 | 310.22 / 370.96 | 6.84% |
| 800 | ON | filter-authorized-kanban | 753.86 / 803.67 | 725.49 / 802.73 | -0.12% |
| 800 | ON | refresh-with-draft | 450.22 / 537.31 | 491.22 / 590.48 | 9.89% |

Negative change is faster. Every condition with more than 10% p95 regression remains a failed proposed guardrail, regardless of median or explanatory hypotheses.

| Tickets | Flow | Variant | First detail request p95 ms | Response to visible probe p95 ms | Whole journey React actualDuration p95 ms |
|---:|:---:|---|---:|---:|---:|
| 80 | OFF | before | 45.41 | 317.15 | 661.70 |
| 80 | OFF | after | 29.84 | 332.13 | 692.90 |
| 80 | ON | before | 40.54 | 324.02 | 673.10 |
| 80 | ON | after | 29.27 | 350.04 | 681.00 |
| 800 | OFF | before | 39.08 | 312.31 | 869.10 |
| 800 | OFF | after | 30.37 | 302.49 | 877.80 |
| 800 | ON | before | 42.65 | 319.68 | 849.60 |
| 800 | ON | after | 29.83 | 307.24 | 871.70 |

The response-to-visible probe is not an isolated rendering measurement: it includes client handling, existing presentation timing and Playwright observation. The unchanged presentation policy has a 260 ms content deadline; these figures must not be interpreted as permission to shorten it. Optional-module completion, remote D1 latency, full logical backend spans and D1 rows_read/rows_written remain unmeasured.
