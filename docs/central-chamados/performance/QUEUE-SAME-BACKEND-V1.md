# Queue scheduling causal comparison

Harness `fff045800dee5181c83f3282b211ebf3c9f98bcc`; 180 measured journeys plus 6 excluded warmups; Chromium 140.0.7339.16. Owner, flow ON, 80/800 synthetic tickets, 30 samples per variant and volume in six balanced order permutations. Separate immutable UI bundles; source hashes verify that only TicketKanbanBoard differs. Same frozen backend, fixture and recorded dependency versions. No concurrent local tests, builds or benchmarks.

`serial` is the existing open-first request followed by three concurrent siblings, not four serial requests. The initial List is prepared before timing and its visible subject must match an authorized response. First Kanban content requires a visible real subject excluding skeletons; rendered codes/subjects are checked against authorized responses. Each journey makes four queue reads with the prepared token and retains exactly one snapshot.

| Tickets | Scheduling | First p50 / p95 ms | Four pages p50 / p95 ms | First p95 change | Four p95 change |
|---:|---|---:|---:|---:|---:|
| 80 | serial | 442.81 / 526.57 | 646.80 / 671.36 | 0.00% | 0.00% |
| 80 | parallel | 639.15 / 705.89 | 705.52 / 773.04 | 34.05% | 15.15% |
| 80 | bounded | 500.04 / 523.82 | 655.27 / 705.57 | -0.52% | 5.10% |
| 800 | serial | 435.40 / 807.73 | 784.09 / 932.60 | 0.00% | 0.00% |
| 800 | parallel | 864.04 / 960.88 | 926.08 / 1013.73 | 18.96% | 8.70% |
| 800 | bounded | 526.34 / 586.47 | 787.59 / 884.90 | -27.39% | -5.12% |

Recorded request failures/aborts: 0. All prepared-snapshot invariants: true. Four-way parallelism remains rejected. The two-worker candidate stays within the proposed 10% p95 regression guardrail here, but does not demonstrate the 30% target and has worse first-content medians. Its separate complete journey subsequently failed the guardrail (80/flow ON first content +22.9%). Both scheduling candidates are reverted; delivered scheduling returns to 13b3a66. No timing or loading-presentation policy changed.

This isolates local scheduling, not remote D1 performance. The same-process adapter, React Profiler and Playwright add overhead. The six-way order balances execution order but does not make this host a controlled performance appliance. Do not combine these absolute timings with the earlier full-journey protocol. Every result, including rejected variants, is retained.
