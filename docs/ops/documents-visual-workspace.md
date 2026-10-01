# AD-VIS-02 — Document workspace candidate

Execution folder: https://drive.google.com/drive/folders/1Hs_pbAph0wRlHopO9NvShsNGPDk_JEOU
Base: AD-VIS-01 `40f615e602d5f02c141ad8cd645fc591a72a80b5` (PR #220, still draft).

## Intermediate audit and plan adjustment

The user supplied a Preview image: the original white-field conflict is no longer visible in that frame,
but the document layout does not meet the reference. The first PR's CI/build and Preview passed;
that is not evidence of all real routes or backend acceptance. The correct next product increment
remains a structural document redesign, not another global recoloring.

Plan pivot: prepare AD-VIS-02 as a **dependent draft candidate**, without merging #220 or asserting
G04 is fully closed. This permits real built-UI regression evidence to be gathered for the combined
candidate while legacy/authenticated checks remain explicit blockers. Merge order remains #220 then
AD-VIS-02 (after reevaluation). No green CI status authorizes production operations.

## Implementation and boundaries

- Preserve the original 1,227-line controller prefix (only two presentation imports added).
- Introduce semantic header, folder cards with real facet counts, explicit nested paths/breadcrumbs,
  two-row desktop filters, document results panel, compact table and accessible secondary menus.
- Virtual All/Root cards cannot be renamed or deleted. All means all folders, not a fabricated total.
- Preserve the files/folders APIs, grants/denies, transfer/retry/progress, draft/applied filters,
  cursor pagination, Trash metadata, restore expiry and permanent-purge confirmation/flag gates.
- Use actual organization scope; no fictional author, bulk selection, grid mode or numbered pages.
- Local CSS container queries respond to available content width. Sidebar, Admin and Kepler are
  not redesigned. Portal-menu rules are namespaced independently.
- `DocumentsTransferPanel.css` owns transfer/feedback only; workspace rules live in `DocumentsSection.css`.

## Validation layers

The Node contract freezes business-prefix bytes. The dedicated workflow independently compares that
hash to the pinned original Git object, builds the application and runs the actual React /projects
route in Chromium, Firefox and WebKit with intercepted APIs. The normal reliability workflow is kept.
Screenshots and test JSON identify the tested candidate; they do not prove real authentication,
D1, Dropbox, Production, operational cleanup or untested routes.

Local environment: Git clone/npm network access was unavailable. Syntax/CSS parsing and a JSX-derived
static layout fixture are local evidence only. Full compiler/browser claims require actual CI logs.
The historical Preview folder/upload issue H-07 remains open.

## Gates and next step

Do not merge while build/browser/visual evidence is failing or pending. Compare the real built screenshots
to the reference and obtain the user's visual acceptance. Complete real legacy/subtab checks and the
appropriate authorized environment acceptance. Update the tracker, audit and replan before release.
The existing production-acceptance policy and credential boundary apply unchanged.

## Migrations and rollback

No migration, D1/Dropbox write, permission change, flag activation or Worker deployment is included.
The historical 0024 is not an instruction to reapply schema. If a new environment needs schema,
record MIGRATION PENDENTE DE CONFIRMAÇÃO and block the relevant operational gate.

Rollback AD-VIS-02 alone preserves the fallback isolation from #220. Code rollback does not undo
file operations. Never use purge as an automatic smoke test.
