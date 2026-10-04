# Users and Access workspace

## Scope

Visual redesign of Projects → Usuários e Acessos on PR #222, based on
`158e2b3c1d05dbe69589d610167754ac72787215`. No backend, migrations,
authentication, role model, access-governance policy or production settings change.

- Minimal breadcrumb and title; existing Admin shortcut remains super-admin only.
- Search, status and profile filters retain their values and matching semantics.
- Responsive dark/gold table and team indicators use the existing density tokens.
- Exactly one `DocumentsPagination`, using the unchanged component and exact shared
  CSS declarations from Documents/Central/Roadmap. No copied or decorative footer.
- Per-person three-dot menu reuses `DocumentActionMenu`, including its portal,
  keyboard navigation, Escape/Tab/outside dismissal, focus handling and placement.
  People without any permitted action retain a disabled three-dot control.

## Before / after action inventory

| Action before | Presentation after | Gate and destination |
| --- | --- | --- |
| Mapa button | Mapa menu item | Existing `canManageMapPerson`; passes the same person ID to `ProjectMapAccessManager` |
| Gerenciar button | Gerenciar menu item | Existing `canManagePerson`; passes the same person ID to delegated `OrganizationPermissionManager` |
| Gerenciar no Painel Admin | Same header link | Existing super-admin gate and encoded organization ID |
| No eligible action | Disabled three-dot button | No menu items or new authority |

There were no status, role-change, removal or invitation actions in this overview.
None were invented. Existing manager modules, confirmation flows, loading/disabled
states, mutation endpoints and `onSaved` callbacks are byte-identical to the baseline.

## Pagination and context isolation

`GET /api/organizations/:id/users` requires `users.view` for that organization and
returns the complete eligible membership array. Its real SQL is organization-scoped,
includes suspended people, excludes inactive memberships where supported, and has no
cursor, `LIMIT` or `OFFSET`. Client-side slicing therefore follows the existing search,
status and profile filters. The footer's total is the length of that authorized,
filtered array; it is not a global user count or a presumed backend total.

Page sizes are 10/25/50. Filter changes reset immediately to page one; refreshes clamp
a shortened result without resurrecting a former page when it grows. Metrics and
capacity retain the full roster as their input. The organization/actor/permission
context remounts the workspace before old rows, targets or popovers can render, and
request epochs discard stale responses. Initial loading/error does not claim a zero
or fabricated total.

## Preservation evidence

`tests/fixtures/users-access-baseline.json` pins the pre-redesign source from the exact
baseline commit, including its SHA-256. The former whole-view selector migration hash
is replaced only for this consumer by byte-exact helper and AST-exact business-logic
contracts. The former migration hash is still asserted against the independent
baseline. All other migration hashes remain unchanged.

Contracts cover helpers, API read batch, limits permission gate, governance fallback,
role/permission predicates, self/suspended/target-level exclusions, filters, metrics,
Admin destination, manager guards/props/callbacks and absence of direct writes.
Mutation tests deliberately alter gates/handlers and require the contract to reject them.
Real SQLite fixture tests exercise more than 50 members, cross-organization exclusion,
suspended members, stable ordering, and organization-scoped grants/denials.

## Validation and limits

- Source-scoped ESLint and TypeScript build checks pass.
- Shared Documents/Central/Roadmap and router preservation contracts pass.
- Browser gate: `playwright.users-access.config.ts`, compiled app on loopback with
  synthetic intercepted HTTP; Chromium, Firefox and WebKit, desktop and mobile.
- Browser checks cover pagination, filters, organization changes and late responses,
  data shrink/growth, loading/error/empty/permission states, long names and overflow,
  menu keyboard/placement/dismissal, original action gates and correct modal targets.
- Browser evidence includes screenshots and per-case request traces, collected by
  `.github/workflows/users-access-workspace.yml`.

Browser tests never mutate real users or contact production APIs. A local intercepted
PATCH may update synthetic map-access state to verify refresh/clamp behavior. These
fixtures prove rendered integration and request contracts, not live production D1,
authentication or production acceptance. Publication, remote checks and Preview remain
separate verification steps; no merge or production deployment is performed.

### Diagnostic notes

The first Chromium pass validated the shrink clamp (`36 → 11`, page 2) before a test
failed on Playwright's synchronous `checkbox.check()` assertion. The unchanged
`ProjectMapAccessManager` is response-driven: `changeCreate` awaits the API, then
updates controlled checkbox state via `setPolicy(next)`. The test now sends the same
click and awaits the checked state without increasing timeouts; it then verifies
growth (`11 → 21`) stays on page 2. No application handler changed for this case.

Separately, the synthetic map-access fixture was made stateful by organization/user
so partial PATCH responses retain prior fields, matching the real full-policy API.
The case explicitly asserts the Editor route survives `createEnabled: true` and
records request/response payloads plus before/after pagination in
`clamp-state-evidence.json`. No real organization/user writes are performed.

Both existing management backdrops were measured against the viewport on desktop and
mobile after the redesign; no containing-block regression was found, so no speculative
portal changes were made. Menu Escape/Tab/selection focus handling is covered.
The initial review found that the existing management dialogs did not restore focus
when their Close button dismissed them. This is now corrected at the overview's visual
boundary for both managers, without changing their modules or domain logic. Closing
schedules focus to the current, connected and enabled action trigger for the same user
inside the same workspace. A fresh DOM lookup survives roster refreshes. Missing,
disabled or off-page targets are skipped; unmount cancels pending work, and a newer
dialog or user focus/navigation prevents stale focus restoration. Closing during an
in-flight roster refresh never schedules a later focus steal when that response arrives.

The baseline contract allows only the exact two onClose extensions (the original
setTarget(null), followed by restoration for that same target ID). Every other manager
guard, prop, API, permission predicate and mutation callback remains protected.

### Final local gate (2026-10-04)

- Compiled final bundle: `index-BlAkQqKZ.js` / `Projects-D_HdSwJn.js`.
- Full Node aggregate: **2,401/2,401 passed**.
- Users compiled browser gate: **84/84 passed**, 28 each in Chromium, Firefox and WebKit.
- Shared Documents/Central/Roadmap compiled regression: **21/21 passed** on the prior
  gold-layout bundle, before the isolated overview focus-boundary change.
- Equivalent Roadmap overlay geometry audit: **6/6 passed**, desktop/mobile in all engines
  on that prior bundle; the focus correction did not change Roadmap. No additional source
  change was justified.
- Typecheck/build and changed-source/test/config lint passed. A separately observed
  existing `react-refresh/only-export-components` violation in `Projects.tsx` line 242
  was outside the changed breadcrumb adapter and is not counted as a global lint pass.
- Desktop full-footer and mobile-menu screenshots were visually inspected, including
  the corrected gold capacity progress, dark menu, 44px targets and single shared footer.
- Final focus coverage proves mouse/keyboard opening, both manager Close controls,
  roster refresh replacing the opening DOM node, absent/disabled/off-page targets,
  newer page/section navigation and closing while a roster request is pending.

Firefox's local container launch used temporary software-rendering preferences only;
the repository CI configuration remains based on the existing compiled-browser gate.

### CI ratchet compatibility

The local monotonic read fence is named `readRevision` so the existing diagnostic-ID
ratchet does not confuse it with operational metadata intended for error reporting.
This is only an identifier rename; the ratchet script and its baseline remain
unchanged. The exact strict-baseline command passes. A fresh build produced all
135 output files byte-identical to the bundle exercised by the final 84 browser
cases, and the complete Node aggregate passed again (2,401/2,401).
