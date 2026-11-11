# Organization deletion: reviewed error-sink inventory

The strict scanner finds exactly two `diagnostic-id` lines in
`src/pages/Admin/organizations/OrganizationDeletionPanel.tsx` because the local
idempotency variable is named `requestId`.

1. The first line chooses the previously retained key or a new `crypto.randomUUID()`
   and stores it as the recovery coordinate.
2. The second line passes that same key through the existing same-origin API
   transport as the `Idempotency-Key` header for the deletion request.

Neither line consumes a server diagnostic, raw response body or `Error.message`,
nor interpolates the key into user-facing error copy. The recovery key is retained
in the browser URL to resume an uncertain operation after reload. It is not an
authentication credential: the server separately checks the authenticated Super
Admin and binds lookup/idempotency to the actor. The panel's displayed operation
identifier is a separate deliberate administrative recovery reference.

The baseline adds only this file/rule pair with count **2**. Scanner patterns,
excluded files, existing entries and strict comparison behavior remain unchanged.
The regression in `scripts/audit-user-error-sinks.test.mjs` checks the exact two
source lines, rejects raw error/response sinks and verifies that `requestId` is not
used in rendered JSX. More uses or different uses require review rather than a
broader allowance.

The CLI entry-point check now uses `fileURLToPath(import.meta.url)` so Windows
drive paths are compared correctly and cannot silently skip the audit. A real
Node subprocess regression scans a synthetic source tree in a path with spaces,
checks nonempty JSON output, and requires exit status 1 plus the exact mismatch
for an intentionally empty strict baseline. The test runs on Windows and POSIX
without relying on the repository's current inventory.
