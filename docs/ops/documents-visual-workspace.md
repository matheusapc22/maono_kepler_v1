# AD-VIS-02 — Document workspace candidate

Execution folder: https://drive.google.com/drive/folders/1Hs_pbAph0wRlHopO9NvShsNGPDk_JEOU

## Baseline and dependency

AD-VIS-01 / PR #220 is merged into `mano_kepler_v1` at `0d4871d4856ae0241d8d5870ffaefcdd2ace03aa`.
Migration `0024_document_folders_trash.sql` is unchanged. It is the existing schema prerequisite for folders and trash; do not reapply it by inference.

## Approved navigation

- Documents opens directly in **Raiz**, showing its immediate child folders and only files stored directly at root.
- There are no virtual **Todos os documentos** or **Raiz** cards.
- The persistent breadcrumb starts at **Raiz** and follows the actual selected folder lineage. Nested folders show only their direct children and files.
- **Todos os documentos** is an option in the existing **Pasta** file-list filter. It does not change the browsed folder or its breadcrumb/cards.
- All-documents results show their full folder origin in both list and grid, including **Raiz** for unfiled documents.
- Selecting a specific folder in the filter navigates to that folder; clicking a folder/breadcrumb returns the file list to that folder. Clear filters and removing the all-documents chip return to Raiz.
- Trash listing never receives a root folder filter, so retained documents from other folders remain visible.

## File actions and preserved features

- Active file rows/cards expose only one ellipsis, ordered **Renomear, Baixar, Mover, Excluir**, filtered by manage/download/delete grants.
- Move opens a native modal destination picker with keyboard focus containment, Escape/Cancel, server-error visibility and no-op prevention.
- The modal closes in layout cleanup while still attached to the document, then restores focus to its trigger or current breadcrumb. This avoids WebKit retaining modal inertness after node removal.
- Initial picker focus runs only after `showModal()`. React `autoFocus` on the still-closed dialog cleared the opener to BODY in WebKit; keeping the opener intact restores Escape/Cancel and move-out focus correctly.
- Rename preserves the original file extension. Delete keeps the existing reversible ten-day trash confirmation; permanent purge is not part of that menu action.
- Existing folder move/rename/delete, list/grid mode, typed icons, keyset pagination, search/date/type/project filters, transfer UI, restore, permission checks and menu keyboard/scroll fixes remain intact.
- Mutation refreshes use the latest file query after navigation. The winning query clears superseded loading modes, preventing old responses from replacing the current view or leaving empty folders loading.

## Backend audit

No new backend change or migration is required for this navigation revision:
- `folderId=root` restricts the query to NULL folder_id;
- a real folder ID returns only direct files;
- omitted/empty folderId returns all authorized same-organization documents;
- list responses expose folderId, enabling origin rendering from the authorized folder tree;
- session/document.view, tenant and GeoJSON gates, counts, facets and cursor pagination stay enforced.

Rename was the missing action in the preceding implementation and is now supported by PATCH files/:fileId with `{ name }`:
- requires document.manage and the existing GeoJSON authorization;
- updates only name/original_name/updated_at, and records document.rename audit;
- preserves Dropbox path/id/revision, stored filename, bytes and folder/project links;
- rejects invalid names, changed extensions, cross-tenant/unavailable files and concurrent trash transitions.

Download, file move, reversible deletion/restore and folder CRUD/hierarchy reuse their existing endpoints. Folder movement keeps same-organization scope, sibling uniqueness, cycle protection and maximum depth five.

### Existing upload limitation

Upload still writes to **Raiz**, including when a subfolder is being browsed. The current upload parser and creation contract do not accept/store folderId. This revision deliberately preserves that existing contract; moving the uploaded file afterward uses the existing Move action. Do not imply upload automatically targets the open folder.

## Validation and release gates

The document workflow verifies the pinned original controller, document contracts, folder/filter/rename backend suites, full application build and the compiled React route in Chromium, Firefox and WebKit.

Regression coverage includes root/default query, absence of virtual cards, direct hierarchy, all-document origins, repeated filter/navigation transitions, list/grid, pagination, each file action, permission limits, cancellation, denied requests, late responses and modal/menu focus.

The PR stays Draft until all required gates pass. Screenshots/API-intercepted browser tests and SQLite/provider fixtures are regression evidence, not authenticated Preview acceptance.

**H-07 remains open** until an authenticated Preview run creates disposable nested folders, moves a folder, uploads, queries the destination and cleans up. The new rename/download flow should also be included in that real acceptance. Passing CI or Preview does not authorize a production rollout.

## Rollback

Reverting AD-VIS-02 preserves AD-VIS-01 / PR #220. No migration rollback, production flag change or production deployment belongs to this revision.
