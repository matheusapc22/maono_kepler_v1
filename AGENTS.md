# Maõno Maps — Production D1 Migration Policy

This repository uses Cloudflare D1. The canonical production database is:

- database name: `maono_maps`
- database UUID: `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`
- product / production branch: `mano_kepler_v1`

Production migrations are a human-gated operation. Preparing code, merging a PR, passing CI, publishing Preview, or receiving a generic instruction such as “continue” never authorizes a production migration.

## Mandatory lifecycle

Every production migration must follow this exact sequence:

1. **PREPARE** — create/review the SQL and its tests.
2. **LOCAL VALIDATE** — run the relevant migration tests and application gates.
3. **AUDIT READ-ONLY** — run `npm run migration:audit:production -- --migration <file.sql>`.
4. **REPORT AND STOP** — show the user the exact migration, SHA-256, Git SHA, production D1 identity, risk classification, pending-migration digest, earlier pending migrations, integrity result, Time Travel bookmark, audit report path, and approval hash/text. Do not apply anything yet.
5. **WAIT FOR EXPLICIT HUMAN AUTHORIZATION** — authorization must be given after the audit and must explicitly identify the audited migration and approval hash (or the exact authorization text emitted by the audit).
6. **APPLY ONLY THE AUTHORIZED MIGRATION** — run `npm run migration:apply:production` using the audit report and its exact approval token.
7. **POST-VALIDATE** — confirm the D1 ledger, `PRAGMA quick_check`, `PRAGMA foreign_key_check`, and report the recovery bookmark.
8. **STOP AGAIN** — authorization is single-use in scope. A different migration always requires a new audit and new explicit authorization.

## Authorization rules

Valid authorization must identify the audited migration and the audit approval hash/token. Example:

`Autorizo executar em produção a migration 0027_example.sql, approval <hash>, no D1 maono_maps.`

These are **not** production-migration authorization:

- `continue`, `prossiga`, `dê sequência` or similar generic language;
- approval to create code, a migration file, a branch, a commit, a PR, a merge, a deploy, Preview, QA, acceptance, feature flags, or another operational task;
- authorization for another migration;
- an authorization made before the current audit report;
- an authorization whose migration, approval hash, Git SHA, file SHA-256, pending digest, or database identity no longer matches.

Never manufacture, infer, or self-grant the human authorization. The apply token may be passed to the executor only after the user has explicitly authorized the matching audit in the current workflow.

## Before authorization: allowed

- inspect and create migration SQL;
- inspect schema and migration history;
- run tests, typecheck, build and static checks;
- calculate SHA-256 and Git SHA;
- run `d1 info`;
- run SELECT/read-only PRAGMAs;
- read the `d1_migrations` ledger;
- run D1 Time Travel `info`;
- execute `migration:audit:production`;
- prepare rollback/recovery guidance;
- open/update a PR containing migration tooling or migration SQL.

## Before authorization: forbidden

Do not perform any production D1 write, including direct or indirect use of:

- generic `wrangler d1 migrations apply ... --remote` against the repository migration directory;
- `d1 execute` with `INSERT`, `UPDATE`, `DELETE`, `REPLACE`, `CREATE`, `ALTER`, `DROP`, or other mutating SQL;
- scripts that write to the production binding;
- migrations bundled with unrelated pending migrations.

## Required preflight evidence

Before asking for authorization, confirm at minimum:

- current 40-character Git SHA and a clean worktree;
- exact migration filename and SHA-256;
- Wrangler version;
- Cloudflare authentication is usable;
- remote D1 name and UUID exactly match the canonical production database;
- current remote `d1_migrations` ledger;
- selected migration is still pending;
- all other local pending migrations, especially earlier ones;
- digest of the pending set;
- SQL operation/risk classification;
- `PRAGMA quick_check = ok`;
- empty `PRAGMA foreign_key_check` result;
- a valid current D1 Time Travel bookmark.

If any item cannot be verified, stop without applying the migration.

## Isolated apply is mandatory

The production apply executor must use a temporary Wrangler configuration whose `migrations_dir` contains **only the exact authorized migration file**. Never point `wrangler d1 migrations apply` at the repository's complete `migrations/` directory for a production write.

Earlier pending migrations are evidence to report, not permission to apply them. They remain untouched unless they receive their own explicit audit and authorization.

## Drift invalidates authorization

After authorization and immediately before the write, re-check:

- D1 name/UUID;
- migration SHA-256;
- Git SHA and clean worktree;
- selected migration still pending;
- pending-set digest;
- audit approval hash/token;
- database integrity;
- a fresh Time Travel bookmark.

Any mismatch means **STOP and re-audit**. Do not ask whether to ignore the mismatch and do not substitute another migration.

## Post-migration validation

After a successful apply:

- verify the exact migration appears in `d1_migrations`;
- run `PRAGMA quick_check`;
- run `PRAGMA foreign_key_check`;
- report the migration filename/hash, Git SHA, `applied_at`, recovery bookmark, integrity checks, and post-validation report path;
- list remaining pending migrations without applying them.

If apply may have started but the final result is uncertain, treat the write outcome as unknown, preserve the recovery bookmark, stop, and perform read-only verification before any retry.
