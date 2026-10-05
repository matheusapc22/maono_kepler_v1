# Private document preview

Click a document name in the active list or grid to open the native Maõno dialog. PDF pages, static PNG, JPEG and WebP are supported. The dialog provides page navigation, zoom (50–300%), text extracted from the current PDF page where available, close/Escape, and download of the original. Unsupported formats (including Office, SVG and HTML), password-protected/invalid PDFs and oversized files provide a clear download fallback.

## Authorization and privacy

- Preview requires the existing `document.download` permission as well as the section's `document.view`. Listing permission alone never grants bytes.
- It uses exactly the existing same-origin authenticated `/api/organizations/:id/files/:fileId/download` route. Its server-side organization/file/trash/special project-config authorization is unchanged.
- No public link, external document viewer, conversion service, new endpoint or persistent document cache is introduced. Requests use `cache: no-store`; the route retains `private, no-store` and attachment disposition.
- The original download uses the existing transport and rechecks authorization. Download failures are visible inside the modal. Known denial or unavailability cancels pending preview work and clears rendered content.
- Organization/user/permission-key changes remount the owning section. Closing/unmounting aborts the preview fetch, ignores stale asynchronous results, destroys the PDF worker and frees canvases/object URLs. Image URLs are revoked on close or replacement.

## Limits and rendering

- Preview cap: 20 MiB, enforced against metadata, response length when present and actual streamed bytes. Original downloads retain existing application behavior (50 MiB upload limit).
- Progress reflects actual received bytes. It is indeterminate if the existing streaming response has no `Content-Length`; no simulated percentages.
- Filename allowlist, declared MIME and file signatures must agree. `application/octet-stream` is accepted only after signature checking. Images are checked before decode: at most 16 million pixels, at most 12,000 pixels per side. Animated PNG/WebP are excluded.
- PDF.js **6.4.299**, pinned, official legacy core and worker. The legacy bundle supplies compatibility polyfills required by tested browser versions. Only the current page is rasterized; a canvas is bounded to 4 million pixels/4,096 pixels per side. Embedded images are capped. Fetch timeout: 120 seconds; PDF parsing/page rendering deadline: 30 seconds.
- Optional page text uses a bounded stream reader compatible with WebKit (100,000 characters, 10-second deadline). Its failure leaves the rendered page available; cancellation releases the reader without waiting on an unresponsive worker.
- The canvas renderer does not create a PDF scripting manager, execute document JavaScript, mount forms/XFA, expose PDF embedded attachments, links, HTML or active annotations. Text is plain React text. PDF.js worker, fonts, CMaps, ICC/codec Wasm and the two decoder JS fallbacks are packaged on the same origin. No CDN or CSP relaxation is added.
- Complex or malformed PDFs may be unavailable for preview; download remains the fallback. Canvas rasterization is not a full accessible PDF reader; extracted page text and original-file download supplement the accessible dialog controls.

## Verification

`npm run test:document-preview` runs transport/signature/memory-boundary tests, the real download handler against local SQLite with simulated external storage, and preserved document-controller contracts. `npm run test:document-preview-browser` exercises the built `/projects` route with synthetic intercepted APIs in Chromium, Firefox and WebKit; PDF workers and image decode are real. It covers list/grid, repeated open/close, rapid PDF controls, focus wrapping/Escape/focus return, mobile bounds, unsupported/large/invalid input, access failure, delayed response races, original download and organization changes. The CI workflow uploads traces/screenshots. No production data, credentials or deployment is involved.

The PDF and image fixtures are synthetic test artwork generated locally. They contain no customer information.

### Local evidence (2026-10-05)

- Expanded Node suite: 2,565 passing tests; real SQLite/API permission tests included.
- Local typecheck and production Vite build initially passed with a 4 GiB V8 heap, but the Cloudflare build of `a997442` exhausted that heap during chunk rendering. Vite retains the original 6 GiB budget; TypeScript retains 4 GiB. Local builds are serialized to avoid unrelated shared-host memory pressure.
- 28/28 built-app browser checks passed in Chromium and Firefox. [Desktop PDF](evidence/preview-pdf-desktop.png), [mobile PDF](evidence/preview-mobile.png), [image from grid](evidence/preview-image-grid.png) were visually inspected. Only synthetic API responses were intercepted; PDF.js, worker, image decoding, dialog, keyboard and downloads ran in the actual application.
- Local WebKit could not launch: its preexisting runtime has dangling native-library links. This is unverified locally, not a passing test. The new CI gate installs official browser dependencies and runs all three engines.
- The [three-engine CI run for `a997442`](https://github.com/matheusapc22/maono_kepler_v1/actions/runs/37333306566) passed all 42 browser checks, including WebKit PDF text streams. Successful WebKit desktop PDF, mobile PDF and grid-image screenshots were also visually inspected.
- Preview error text is selected from a closed reason catalog; exception messages never enter the UI. The unchanged strict error-sink ratchet passes.
- Targeted ESLint and `git diff --check` pass. Full-repository lint still reports 119 errors and 53 warnings in untouched files; those are outside this feature.
