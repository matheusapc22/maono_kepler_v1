"""Produce a sanitized Organization transport fixture from synthetic inputs only."""

import argparse
import json
from pathlib import Path
import re

from organization_case_fixture import CASES, PRODUCT_BRANCH, case_files

CASE_ID = "synthetic-organization-update"
NAME = "organization-evidence.json"


def produce(directory, run, sha, *, case=CASE_ID, workflow_sha=None):
    if not 0 < run < 10**16 or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("INVALID_SYNTHETIC_RUN")
    # There is no source payload to redact. Every emitted key is explicitly constructed.
    envelope = {
        "version": 1,
        "kind": "organization-synthetic-transport-fixture",
        "run": run,
        "attempt": 1,
        "sha": sha,
        "caseId": CASE_ID,
    }
    if workflow_sha is not None:
        if not re.fullmatch(r"[0-9a-f]{40}", workflow_sha):
            raise ValueError("INVALID_WORKFLOW_SHA")
        _, sample = case_files(run, sha, case)
        envelope.update(version=2, kind="organization-sandbox-case", caseId=case,
                        workflowSha=workflow_sha, productBranch=PRODUCT_BRANCH, observation=sample)
    elif case != CASE_ID:
        raise ValueError("EXPECTED_WORKFLOW_SHA")
    target = Path(directory) / NAME
    with target.open("x", encoding="utf-8", newline="\n") as output:
        output.write(json.dumps(envelope, sort_keys=True, separators=(",", ":")) + "\n")
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=int, required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--workflow-sha")
    parser.add_argument("--case", choices=CASES, default=CASE_ID)
    args = parser.parse_args()
    try:
        print(produce(args.directory, args.run, args.sha, case=args.case, workflow_sha=args.workflow_sha))
    except ValueError:
        parser.exit(1, "INVALID_SYNTHETIC_RUN\n")
    except OSError:
        parser.exit(1, "SYNTHETIC_ARTIFACT_WRITE_FAILED\n")


if __name__ == "__main__":
    main()
