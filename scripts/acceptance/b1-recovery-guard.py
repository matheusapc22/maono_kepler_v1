"""Authorize recovery-only replay of the original interrupted sandbox run."""

import json
import os
import subprocess
import sys

REPO = "matheusapc22/maono_kepler_v1"
CHECK = "Verify reviewed PR is still open at the dispatched commit"
MUTATION = "Observe or restore the three B1 sandbox fixtures"
INTERRUPTED = {"failure", "timed_out", "cancelled"}


def recovery_allowed(history, sha, run):
    if not history:
        return False
    for attempt, jobs in enumerate(history, 1):
        matches = [j for j in jobs if j.get("name") == "b1-cloudflare"]
        if len(matches) != 1:
            return False
        job = matches[0]
        if (job.get("head_sha") != sha or job.get("run_id") != run or
                job.get("status") != "completed" or job.get("conclusion") not in INTERRUPTED):
            return False
        if attempt == 1:
            steps = {step["name"]: step for step in job.get("steps", [])}
            if (steps.get(CHECK, {}).get("conclusion") != "success" or
                    not steps.get(MUTATION, {}).get("started_at") or
                    steps[MUTATION].get("conclusion") in {None, "skipped"}):
                return False
    return True


def main():
    env = os.environ
    run, attempt = int(env["GITHUB_RUN_ID"]), int(env["GITHUB_RUN_ATTEMPT"])
    if (env["GITHUB_REPOSITORY"] != REPO or env["GITHUB_TRIGGERING_ACTOR"] != "matheusapc22" or
            env["GITHUB_ACTOR"] != "matheusapc22" or env["B1_ORIGINAL_MODE"] not in {"run", "closure"} or
            run <= 0 or attempt < 2):
        return 1
    history = []
    for previous in range(1, attempt):
        endpoint = f"repos/{REPO}/actions/runs/{run}/attempts/{previous}/jobs?per_page=100"
        response = json.loads(subprocess.check_output(["gh", "api", endpoint]))
        if response["total_count"] != len(response["jobs"]):
            return 1
        history.append(response["jobs"])
    return 0 if recovery_allowed(history, env["GITHUB_SHA"], run) else 1


if __name__ == "__main__":
    sys.exit(main())
