# Historical deletion execution proof (local only)

This extends the complete 530-object structural projection only inside tests. It is not an operational compatibility profile, a replica of production literals, an initialized production dump or authorization to delete anything. The existing schema evaluator remains incompatible even after the test-only guards are installed.

## Fixed execution layers

1. Verify the manifest's 23 pinned sources and exact complete base object/metadata projection, preserving the two internal objects in its recorded envelope.
2. Execute the seven exact, pinned non-business bootstrap statements listed in `deletion-historical-execution.mjs`. Assert authorization/export singleton rows exist before measuring their effects. No historical business backfill is replayed.
3. Append the unchanged reviewed `0044_organization_permanent_deletion.sql`.
4. Append `additional-guards.test.sql`: exactly ten INSERT/UPDATE pairs, targeting organization_exports, organization_feature_flags, organization_limits, organization_roadmaps, roadmap_comments, roadmap_dependencies, roadmap_events, roadmap_phases, roadmap_tasks and tickets. INSERT tests NEW ownership; UPDATE tests OLD OR NEW. No DELETE trigger is added.
5. Import the actual runtime patch c272f8f1 (local cherry-pick 0b166afb). No alternate runtime, rewritten business decision, monkeypatch or general FK cleanup engine is used.

The source manifest still identifies base 4f48ed5d. The 530-object source projection is verified before the separate bootstrap/migration/test-guard layers; those layers do not retroactively become historical source evidence.

## Physical coverage and its limits

`business-seed.test.sql` contains explicit synthetic recipes. Its manifest records each target's source category, FK prerequisites and insertion line. All 68 business targets contain organization 3 rows with foreign_keys enabled, empty foreign_key_check and quick_check=ok. ticket_message_revisions is populated by the real cc05 trigger. No failed insert, constraint or unknown table is silently skipped.

Some recipes necessarily include business parents in the same organization. Tests separately establish a valid target row, the actual runtime's COUNT for every table and every NOT EXISTS term in the actual atomic claim and finalization statements. Each predicate evaluates false on the populated fixture and the complete assertion rejects it. This is not a claim that a child alone caused the veto. Fixed source SQL also creates an additional change_records row and two roadmap_tasks; counts are deliberately not forced to one.

The ten historical pairs are checked byte-for-byte against their fixed intended definition. Full-schema physical tests cover unlocked insertion, unlocked same/cross-owner updates, locked OLD ownership exit, locked NEW ownership entry, same frozen owner and frozen-to-NULL rejection. All ten organization_id columns are NOT NULL: free-to-NULL is rejected by the real constraint, not silently treated as a permitted lifecycle. The locked INSERT test reuses a row-shaped payload to demand the precise guard error even ahead of uniqueness checks; initial recipe execution independently proves valid unlocked INSERTs.

The only FK children of the four deleted ACL tables are delegation_permissions and delegation_target_levels, both CASCADE from organization_access_delegations. The real cleanup suite covers these cascades, delegation-before-membership order, inactive/expired grants, retained globals/other-org/project-only grants, management archive, session detachment, and transactional rollback. Exact successful SQLite epoch deltas are authorization +5 and export +4: organization claim UPDATE, membership DELETE, denial DELETE, grant DELETE (authorization only), organization DELETE. Rollback deltas are zero.

All seven explicitly synthetic default variants run the same empty-organization cleanup. Business tables are empty in these cleanup variants, and user_permissions.active is explicitly changed to zero before cleanup; these cases do not prove all insertion-default behaviors. Each variant runs with fresh snapshots handled by the structural tests. This proves the tested operations on those representatives, not recovery of original literals or universal application behavior. Business content is vetoed regardless of status rather than cleaned up.

Two physical SQLite connections cover writer-before-claim and a stale writer after a committed claim. The local D1 Worker executes actual DB.batch and a concurrent claim/project-write race. One observed D1 schedule is not all possible interleavings.

## Local D1 reproduction

Create a fresh temporary directory, materialize `historicalExecutionSchema()` to a local SQL file, and configure Wrangler main as `tests/fixtures/deletion-historical-safety/worker.mjs`, compatibility_date 2026-11-01, DB binding with a synthetic UUID. Use Wrangler 4.161.0 `d1 execute ... --local --file <schema> --persist-to <fresh state>`, then `dev --local --ip 127.0.0.1 --port 8796` with the same config/state. POST once to `/proof`, require HTTP 200, success=true and realD1Batch=true. Stop the local Worker. Do not use production config, tokens, remote mode or a previously populated state.

Observed local result: all thirteen labeled checks passed, parallel outcomes [rejected, fulfilled] (claim lost to business insertion). The test checks that claim and business row cannot both survive. No production query was performed.

## Static migration selection: proposal, not implementation

If a separately reviewed operational deletion-safety profile is later approved, use two mutually exclusive fixed SQL files: existing `0044_organization_permanent_deletion.sql` for its canonical pre-state, and proposed `0044_organization_permanent_deletion_historical.sql` containing the identical reviewed common core plus these 20 fixed guards. Both are static, reviewable SQL bytes. Common-core equality should be a source test, not dynamic SQL assembly in the protected runner.

A future operator change would bind each exact filename to one reviewed pre-state profile hash and its file SHA-256. Selection must never follow only observed hashes or fall back between profiles. Audit/apply must reject either file if the alternate or selected entry is already in the ledger, if deletion tables/guards are unexpectedly present, if the complete snapshot drifts, or if the pending set/identity is inconsistent. An ambiguous match must fail closed. Approval material must bind the filename, source/profile version, full snapshot digest (including default literal digests and internals), Git SHA, file hash and mutually exclusive ledger state. Any changed default still invalidates a prior approval even if a later reviewed safety abstraction permits its scalar class.

No historical file, allowlist, ledger mutation or selection code is implemented here. Before that work: independently review all relevant trigger/constraint effects, the remaining opaque-default safety argument and these behavioral results; define exact pre/post-state references; then review operator selection and negative drift/exclusivity tests. Publication, merge, protected audit, explicit migration authorization, apply and flag rollout remain separate decisions.
