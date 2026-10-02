# AD-VIS-02 — Document workspace candidate

Execution folder: https://drive.google.com/drive/folders/1Hs_pbAph0wRlHopO9NvShsNGPDk_JEOU

## Current baseline and dependency

AD-VIS-01 / PR #220 is merged into `mano_kepler_v1` at `0d4871d4856ae0241d8d5870ffaefcdd2ace03aa`.
This AD-VIS-02 candidate is synchronized with that base in the same consolidated commit that carries the final visual/hierarchy correction.

Migration `0024_document_folders_trash.sql` is not changed here. Historical PR evidence from 08-S3/08-S4 records it as confirmed in Preview and Production. Do not reapply it by inference.

## Product correction in this candidate

- real folder browsing: the top level shows only root children; entering a folder shows only its direct subfolders;
- breadcrumb remains the navigation path back to root/all;
- selecting a folder continues to send `folderId` to the existing server-side query for that folder's files;
- current-view buttons are contextual: Documents is hidden while in Documents and Trash is hidden while in Trash;
- list/grid switch is functional;
- file icons now distinguish JSON/GeoJSON, PDF, spreadsheets, images, ZIP and generic documents;
- Move to folder is rendered as the reference control while retaining the original PATCH handler;
- the footer now exposes Items per page, current page, previous and next while preserving the existing cursor backend;
- the first 50 authorized results stay server-paginated by the existing keyset contract; client pages are slices of loaded cursor batches and fetch the next batch only when needed;
- no bulk selection or destructive behavior was invented.

## Backend and integration conclusion

The backend required by the requested behavior predates this PR and was re-audited:
- folder GET/POST/PATCH/DELETE routes exist;
- `parentId` is validated server-side with maximum depth 5, sibling uniqueness, cross-organization guards and cycle protection;
- moving a document changes D1 folder metadata without moving the Dropbox binary;
- upload uses the centralized Dropbox integration and requires organization storage readiness;
- folder listing/creation requires the 0024 schema.

The dedicated PR workflow now runs the folder and file-filter backend suites in addition to the visual contracts and the compiled React browser suite.

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
