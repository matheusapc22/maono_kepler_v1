# AD-VIS-02 — Document workspace candidate

Execution folder: https://drive.google.com/drive/folders/1Hs_pbAph0wRlHopO9NvShsNGPDk_JEOU

## Current baseline and dependency

AD-VIS-01 / PR #220 is merged into `mano_kepler_v1` at `0d4871d4856ae0241d8d5870ffaefcdd2ace03aa`.
This AD-VIS-02 candidate is synchronized with that base in the same consolidated commit that carries the final visual/hierarchy correction.

Migration `0024_document_folders_trash.sql` is not changed here. Historical PR evidence from 08-S3/08-S4 records it as confirmed in Preview and Production. Do not reapply it by inference.

## Product correction in this candidate

- independent views: Todos shows only the Todos/Raiz selectors and all authorized files; Raiz reveals its direct child folders only after selection; a nested folder shows only its direct children;
- persistent breadcrumb shows only Todos in the all-documents view, or Raiz followed by the actual selected folder lineage; Todos is never shown as a parent of Raiz;
- selecting a folder continues to send `folderId` to the existing server-side query for that folder's files;
- current-view buttons are contextual: Documents is hidden while in Documents and Trash is hidden while in Trash;
- list/grid switch is functional;
- file icons now distinguish JSON/GeoJSON, PDF, spreadsheets, images, ZIP and generic documents;
- the file Actions column contains only one ellipsis, exposing Renomear, Baixar, Mover and Excluir according to each permission; Move opens a focus-trapped destination dialog and reuses the existing PATCH folderId handler;
- the footer now exposes Items per page, current page, previous and next while preserving the existing cursor backend;
- the first 50 authorized results stay server-paginated by the existing keyset contract; client pages are slices of loaded cursor batches and fetch the next batch only when needed;
- no bulk selection or destructive behavior was invented.

## Backend and integration conclusion

The existing backend was re-audited; rename was the only missing action:
- folder GET/POST/PATCH/DELETE routes exist;
- `parentId` is validated server-side with maximum depth 5, sibling uniqueness, cross-organization guards and cycle protection;
- moving a document changes D1 folder metadata without moving the Dropbox binary;
- upload uses the centralized Dropbox integration and requires organization storage readiness;
- folder listing/creation requires the 0024 schema;
- rename now uses PATCH files/:fileId with `{ name }`, requires document.manage and the existing GeoJSON access gate, updates only name/original_name/updated_at, preserves the original extension and provider identity, and records document.rename audit;
- download and reversible 10-day trash deletion keep their existing endpoints and permissions;
- no new schema or migration is required for rename.

The dedicated PR workflow now runs the folder, file-filter and rename backend suites in addition to the visual contracts and the compiled React browser suite.

This is still not equivalent to authenticated Preview acceptance. H-07 remains an environment evidence gate until a real authenticated Preview session creates a disposable nested folder and performs a disposable upload with cleanup evidence.

## Validation gates

The PR must remain Draft until:
1. build succeeds;
2. Projects Fallback Scope succeeds;
3. expanded regression succeeds;
4. Chromium/Firefox/WebKit documents workspace succeeds;
5. Cloudflare Preview deploy succeeds;
6. the updated Preview is visually compared against the supplied reference;
7. H-07 is either closed by authenticated Preview evidence or explicitly carried as a release blocker.

## Rollback

Reverting AD-VIS-02 must leave AD-VIS-01 / PR #220 in place. No migration rollback is part of this change and no production flag or Worker activation is included.


## Round: persistent path + folder move

- The breadcrumb is now always rendered in Documents, including the virtual **Todos** view, so the navigation line never appears/disappears between folder states.
- Cards render no real folders in **Todos**, direct root children in **Raiz**, and only direct children inside a selected folder.
- The three-dot menu of every real folder now exposes **Mover pasta**.
- No schema change was required: the existing PATCH route already accepts `parentId`.
- Server invariants reused unchanged: same-organization parent, no self-parent, no descendant cycle, sibling-name uniqueness and maximum depth 5.
- Moving a folder changes only its logical `parent_id`; descendants and document links stay attached to that folder/subtree.
- **No new migration.** Migration 0024 is a pre-existing prerequisite only and must not be reapplied by inference.


## Round: independent views and consolidated file actions

- Todos and Raiz are independent selectors. Switching repeatedly preserves server-side semantics: omitted folderId means all authorized documents; `root` means unfiled documents; a real ID means only that folder's files.
- The breadcrumb always occupies the same navigation line and never renders Todos > Raiz.
- List and grid expose the same single ellipsis, ordered Renomear, Baixar, Mover, Excluir and filtered by existing manage/download/delete grants.
- Rename is a display-only D1 metadata change. The backend rejects invalid names, changed extensions, inactive/trashed files, tenant mismatches and missing grants; existing bytes and Dropbox identifiers/paths are untouched.
- The move dialog retains keyboard focus, supports Escape/Cancel, prevents no-op submissions, keeps server errors visible and refreshes both file listings and folder counts on success. If moving removes its action trigger, focus returns to the current breadcrumb.
- Mutation refreshes read the current query after later navigation; the winning request settles all loading flags so delayed rename cannot replace a newer folder/Trash view or leave an empty folder loading indefinitely.
- Excluir still opens the existing reversible-trash confirmation; it never calls permanent purge.
- Browser coverage includes all/root repeated selection, nested lineage, list/grid menus, keyboard focus, all four actions, cancellation, denied move and download-only grants. Intercepted browser APIs remain regression evidence, not authenticated Preview acceptance.
