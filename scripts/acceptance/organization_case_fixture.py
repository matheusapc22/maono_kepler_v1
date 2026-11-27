"""Closed synthetic case catalogue used by the B1 protected transport rehearsal."""

CASES = ("synthetic-organization-update", "synthetic-organization-pause")
WORKFLOW_BRANCH = "au-ac01-b1-capacidade"
PRODUCT_BRANCH = "mano_kepler_v1"
OPENED_AT = 1_800_000_000_000


def case_files(run, sha, case):
    if case not in CASES:
        raise ValueError("UNKNOWN_SYNTHETIC_CASE")
    identity = {
        "version": 1, "kind": "synthetic", "run": run, "attempt": 1, "sha": sha,
        "origin": "https://maono.invalid", "binding": "synthetic-maono-maps",
        "organization": "synthetic-org", "actor": "synthetic-operator", "caseId": case,
    }
    baseline = {key: {"deployment": "synthetic-base", "configuration": "a" * 64} for key in (
        "pages:maono-kepler-v1", "worker:maono-organization-deletion",
        "worker:maono-organization-storage-recovery",
    )}
    scenario = {
        "clock": OPENED_AT, "ingestAt": OPENED_AT + 10000,
        "manifest": {**identity, "expiresAt": OPENED_AT + 60000, "baseline": baseline},
        "cleanup": {"organization": identity["organization"], "remaining": []}, "beforeRestore": baseline,
    }
    observation = {
        **identity, "observedAt": OPENED_AT + 5000, "operation": case,
        "httpStatus": 200, "effect": "synthetic-effect-confirmed",
        "ui": dict.fromkeys(("stableForm", "goldOverlay", "confirmedTransition",
                             "cornerNotices", "noTechnicalBlocks", "draftPreserved"), True),
    }
    return scenario, observation
