# Local D1 cleanup regression fixture

This is a synthetic, one-shot Worker proof, not a deployment entry point or a production acceptance suite. It imports the real deletion runtime and uses the real local D1 binding `DB.batch`. It contains no real accounts, tokens or business data.

## Reproduce locally

1. Create a fresh temporary directory. Concatenate repository `schema.sql`, `migrations/0012_access_delegation_policy.sql`, and `migrations/0013_user_permission_denials.sql` into `schema.sql` there. These versioned sources restore the membership-trigger interaction; they are **not** a reconstructed full production/historical schema.
2. Create a temporary Wrangler configuration with `main` pointing to this `worker.mjs`, compatibility date `2026-11-01`, binding `DB`, synthetic database name `local_cleanup_binding_proof`, and UUID `00000000-0000-0000-0000-000000000001`. Do not use production configuration or credentials.
3. With Wrangler 4.160.1, run `d1 execute local_cleanup_binding_proof --local --config <temporary-config> --persist-to <fresh-temporary-state> --file <temporary-schema.sql>`. Never use `--remote`.
4. Run `wrangler dev --local --ip 127.0.0.1 --port 8795 --config <temporary-config> --persist-to <same-state>`.
5. POST once to `http://127.0.0.1:8795/proof`. Require HTTP 200, `success:true`, and `realD1Batch:true`. Fixed synthetic IDs intentionally make reuse fail. Stop the local Worker after collecting the response.

The proof covers real batch cleanup and rollback (including cascades, archive, session detach and authorization/export epochs), mixed-scope preview/claim rejection, preservation of other-org/global/project-only ACL, and one observed parallel claim/business-insert outcome. It asserts that a claim and target business project cannot both survive. One interleaving is not a proof of every D1 concurrency schedule. The separate SQLite regression uses two physical connections to cover a stale writer and post-claim reparenting.

No compatibility allowlist, schema source, migration, feature flag or production operator is changed by this fixture. Missing historical guards, unknown schema and unclassified logical links remain blocked. The runtime patch does not certify the complete historical profile or permit deletion of business content.
