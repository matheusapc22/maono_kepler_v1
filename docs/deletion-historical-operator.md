# Explicit historical deletion migration

The historical profile uses the existing protected production operator, not a new service or credential. It accepts only the exact filename `0044_organization_permanent_deletion_historical.sql`. The fixed SQL remains in `scripts/migrations/candidates/`, outside the generic migrations directory. Its reviewed bytes are unchanged: SHA-256 `b04a164e85fe09d292dd8e81ac744ce4deec8927290d38cff326c77e030354fa`.

Canonical and historical migrations are mutually exclusive. Selecting historical does not fall back from canonical or automatically infer a choice. In the selected operation's pending report only, it replaces the canonical entry; generic migration discovery remains unchanged. An already applied selected or alternate deletion migration, malformed ledger, partial installation, unknown object, changed shape or unsupported default is blocked.

The prestate evidence reuses the existing reviewed 530-object historical contract, seven constrained scalar-default slots and 147 planned triggers. It is deletion-safety compatibility, not proof of universal DDL equivalence. Two identical complete metadata reads are required; full actual metadata and literal digests, contract/source hashes, ledger, pending set, Git SHA and candidate bytes are bound to authorization. The runtime/source pins remain validated. No production data is copied or exported.

After explicit approval of the audit's exact hash, the apply operation rechecks ledger, integrity, metadata and local Git/SQL immediately before the isolated write and records the existing Time Travel recovery bookmark. Only the selected file reaches the temporary migrations directory. Post-validation requires the exact added tables, triggers and metadata, unchanged approved pre-existing schema profile, selected ledger entry and integrity. Failure after starting a write is reported as potentially written; never retry blindly.

The protected GitHub approval remains necessary. The workflow contains a fixed existence check for this one candidate path; that workflow change also needs integration in main before dispatch. No dynamic path input, arbitrary SQL, credential expansion or bypass was added.

## Short operational sequence

1. Review and merge code; publish the small matching workflow update to main.
2. Protected read-only audit for the historical filename. Review identity, file/Git hashes, pending set, integrity, recovery bookmark and generated approval hash.
3. Owner authorizes that exact audit; protected isolated apply; post-validation.
4. Keep permanent deletion off until a separately authorized practical acceptance with one new empty test organization and its exclusive Dropbox root. The migration itself deletes no organization or provider content.

Do not overlap this window with schema changes. A successful migration is not an authorization to delete an organization, proof of Dropbox eligibility or permanent feature rollout. Do not disable runtime guards to make a practical test pass.
