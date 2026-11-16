# Synthetic read-only audit: minimal main integration

This draft ports only the pinned metadata reader from the product stack. No product history, SQL, runtime, package dependency or production workflow is changed. Both provisioning and audit plans remain disabled.

## Boundaries
- Hard-pinned isolated account: `1988481e4c75c760516161104b7e1e50`. No production token fallback.
- Exactly three GET requests: pinned D1 metadata, deployment metadata, version bindings. No invocation, writes, provisioning, SQL, retry or deletion.
- Manual owner review in `synthetic-d1-readonly-audit`; Matheus may self-review, so this is not independent review. Admin bypass must be false. Secret is environment-only.
- All resource IDs and artifact hashes remain unset; enabling requires a separately reviewed manifest after real evidence exists. The zero budget is a constraint, not a cost guarantee.

## Evidence limits and next steps
Local tests use fake API responses and do not prove live API compatibility, credential scopes or remote identity. A 100% deployment metadata record does not prove which version is serving; propagation, override protection, bundle provenance, namespace storage identity and invocation remain unproven and explicitly false.

Before any later audit: separately approve merge, collect exact synthetic IDs and artifact identities, review/enable the manifest in a subsequent change, verify short-lived credentials are still valid, and obtain manual environment approval. This PR authorizes no dispatch. Expired credentials are not silently renewed. Main merge may trigger a Pages preview and an unverified Netlify integration; it does not run this audit automatically.

## Port fixes
- Correct GitHub output newline generation using `String.fromCharCode(10)`.
- Restrict metadata reader and manifest to the authorized isolated account, not merely any non-production account.
- Reflect the approved USD 0 ceiling, retain disabled/unconfigured state.

No changes are made to the preserved product PR stack.
