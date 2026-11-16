# Synthetic preflight diagnostic (preparation only)

This workflow diagnoses the failed bootstrap preflight without creating resources.
It is separate from provisioning and does not relax its unique-dispatch gate.

## Fixed boundary
- Only the isolated synthetic Cloudflare account is embedded in the transport.
- Exactly three inventory GET endpoints: D1 databases, Worker scripts and Durable Object namespaces.
- No SQL, creation, upload, delete, invocation, retries, arbitrary URL input or production access.
- The existing provisioning token remains inside its protected GitHub Environment. No credential is copied to local tooling or artifacts.
- Owner dispatch on main, first attempt only, exact confirmation `READ_ONLY_SYNTHETIC_PREFLIGHT`, existing required-owner review and no-admin-bypass policy.
- Uses the provisioning concurrency group to avoid overlapping the provisioner.

## Interpretation
The output contains numeric HTTP/error codes, fixed field/type flags, bounded numeric counts/pagination and parser acceptance booleans. It excludes error messages, resource names/IDs, unknown field names, cursor values, response bodies and tokens. A failure does not authorize rerunning provisioning. A pass only shows that the three inventory responses would meet the current preflight parser at that moment; it is not authorization, cost proof, routing proof or migration readiness.

No remote diagnostic has been run by this PR. Merge and later manual dispatch/environment approval are separate decisions. The diagnostic uses a write-capable credential to reproduce its access, but its code emits only fixed GETs; reviewers must preserve that constraint.

## Local validation
`node --test tests/d1-synthetic-preflight-diagnostic.test.mjs tests/d1-remote-audit-owner-review.test.mjs`

The frontend/product build is unaffected. Existing provisioner and production workflows are unchanged.
