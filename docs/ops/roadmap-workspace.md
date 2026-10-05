# Roadmap workspace

## Current pagination contract

The Roadmap footer uses the same `DocumentsPagination` component and CSS rules as Central de Chamados and Arquivos e Documentos. It **replaces** the former date-range/calendar/timezone strip. Those strings are not retained or moved elsewhere in the page.

- The status is `Exibindo X/Y.`, where X is the number of task rows visible on the current page and Y is the complete filtered task count returned by the API.
- Page sizes are 10 (default), 25 and 50. Previous/next controls and the current page use the shared presentation. Zero results display `Exibindo 0/0.`, page 1, and disabled navigation.
- The backend already returns the complete filtered bundle. Pagination slices only visible task rows locally; it does not request fictitious server pages or reinterpret partial results as totals.
- Gantt and List share the selected page and page size. Switching view preserves page membership while resetting the scroll viewport.
- Organization, roadmap and filter changes restart at page 1. Same-query result reduction clamps to the last available page; later growth does not restore an invalid former page. Changing page size restarts at page 1.
- Pending query results show an updating status and disable pagination controls so stale totals cannot be used as if they belonged to the new query.

## Full-bundle context remains intact

`RoadmapMetrics` and `TaskDrawer` receive the complete bundle. Gantt receives that same complete bundle plus a separate array of visible rows. Roadmap start/end dates, temporal markers, phase/assignee context and metrics are not recomputed from a page-sized slice. Existing task ordering, permissions and API mutation handlers remain in place. No backend endpoint, migration or permission policy was changed.

The shared stylesheet change adds only `.roadmap-workspace` to the eleven existing pagination selectors. It does not alter their declarations or other consumers. The preservation helper reverses exactly that selector extension before checking the original protected presentation bytes.

## Validation

- `tests/roadmap-pagination.test.mjs`: 10/25/50 page sizes; zero, exact boundary and trailing pages; complete ordered membership without mutation; query identity; reset/clamp; invalid index normalization and no resurrection of old pages after growth.
- `tests/roadmap-workspace.test.mjs`: shared component, complete replacement of the prior strip, whole-bundle metric/timeline wiring, responsive structure and theme.
- `tests/browser/roadmap-workspace.spec.ts`: 13 cases per engine covering the compiled application with synthetic intercepted HTTP. Includes real pages in Gantt/List; all rows reachable; unchanged metrics/axis across pages; no extra paging requests; filters/pending results; roadmap/organization switches; shrinking/growing datasets; zero results; keyboard/focus; desktop/mobile scroll stability; drawer controls; loading/error recovery and read-only permissions.
- Existing Documents, Central, project-page and organization-switcher contracts continue to protect shared presentation and unrelated controllers.
- Build/typecheck and focused lint remain required. Three preexisting exhaustive-dependencies warnings in `RoadmapSection.tsx` are outside this pagination change.

Browser fixtures are local regression evidence, not production acceptance. Production credentials, state, feature flags, deployments, merge and acceptance windows are untouched. CI must run against the final PR head.

### Local compiled verification — 2026-10-04

The compiled assets `index-BLeb1Sc4.js` / `Projects-r4j7vi9A.js` passed all **39 distinct browser cases**: 13 Chromium and 13 Firefox cases completed in the first run; an environment interruption ended that process during WebKit, and all 13 WebKit cases passed in the resumed run. The two WebKit cases completed before interruption are not counted twice. The resumed run had zero failures, skipped cases or flaky cases.

Desktop/mobile captures were inspected against the supplied footer references: only the shared quantity/page controls remain, with real counts, the selected page and size, usable arrows, and stable placement outside the task scroller. Whole-bundle metrics, temporal-axis labels and the final-page milestone remain unchanged across pages. The focused Roadmap/shared-footer/preservation contract group passed 108/108; typecheck passed and scoped lint reported zero errors with the same three preexisting hook warnings.
