"""Read-only GitHub transport verifier. It does not adjudicate functional evidence."""

import argparse
import hashlib
import io
import json
import os
import re
import stat
import sys
import urllib.error
import urllib.request
import zipfile
import zlib
from pathlib import Path

from organization_case_fixture import CASES, PRODUCT_BRANCH, WORKFLOW_BRANCH, case_files

REPO = "matheusapc22/maono_kepler_v1"
REPO_ID = 1051393010
BRANCH = "main"
WORKFLOW_PATH = ".github/workflows/production-acceptance-operator.yml"
API_ROOT = f"https://api.github.com/repos/{REPO}/actions"
NAME = "organization-evidence.json"
MAX_ARCHIVE = 128 * 1024
MAX_EVIDENCE = 32 * 1024
MAX_API = 256 * 1024


class Rejected(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Rejected(code)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "DUPLICATE_JSON_FIELD")
        result[key] = value
    return result


def json_object(data):
    require(len(data) > 0, "JSON_INVALID")
    try:
        result = json.loads(data.decode("utf-8"), object_pairs_hook=unique_fields)
    except (UnicodeError, ValueError, RecursionError):
        raise Rejected("JSON_INVALID") from None
    require(isinstance(result, dict), "JSON_INVALID")
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def github_client(token, opener=None):
    require(bool(re.fullmatch(r"[A-Za-z0-9_.-]{20,512}", token or "")), "ACTIONS_READ_TOKEN_REQUIRED")
    if opener is None:
        opener = urllib.request.build_opener(NoRedirect())

    def get(endpoint):
        # Only fixed Actions metadata endpoints may receive this credential.
        require(re.fullmatch(r"/(?:(?:runs|artifacts)/[1-9][0-9]{0,15}|runs/[1-9][0-9]{0,15}/attempts/1/jobs)", endpoint), "API_SCOPE")
        request = urllib.request.Request(
            API_ROOT + endpoint,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            method="GET",
        )
        try:
            with opener.open(request, timeout=10) as response:
                data = response.read(MAX_API + 1)
        except (urllib.error.URLError, OSError):
            raise Rejected("GITHUB_READ_FAILED") from None
        require(len(data) <= MAX_API, "API_RESPONSE_SIZE")
        return json_object(data)

    return get


def validate_target(run, artifact, sha, case):
    require(type(run) is int and 0 < run < 10**16 and type(artifact) is int and 0 < artifact < 10**16,
            "EXPECTED_IDENTIFIERS")
    require(re.fullmatch(r"[0-9a-f]{40}", sha) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,49}", case),
            "EXPECTED_SCOPE")


def matches_fields(actual, expected):
    return isinstance(actual, dict) and all(type(actual.get(k)) is type(v) and actual[k] == v
                                            for k, v in expected.items())


def verify(archive, run, artifact, sha, case, *, workflow_sha, get, sandbox=False, window_directory=None):
    validate_target(run, artifact, sha, case)
    require(0 < len(archive) <= MAX_ARCHIVE, "ARCHIVE_SIZE")
    require(bool(re.fullmatch(r"[0-9a-f]{40}", workflow_sha)), "WORKFLOW_SHA")
    require(window_directory is None or sandbox, "WINDOW_SCOPE")
    branch = WORKFLOW_BRANCH if sandbox else BRANCH
    prefix = "b1-test-case" if sandbox else "organization-evidence"
    if sandbox:
        require(case in CASES, "SANDBOX_CASE")
    record = get(f"/runs/{run}")
    require(matches_fields(record, {
        "id": run, "run_attempt": 1, "head_sha": workflow_sha, "head_branch": branch,
        "event": "workflow_dispatch", "path": WORKFLOW_PATH,
    }) and matches_fields(record.get("repository"), {"id": REPO_ID, "full_name": REPO})
        and matches_fields(record.get("head_repository"), {"id": REPO_ID, "full_name": REPO}), "RUN_SCOPE")
    completed = matches_fields(record, {"status": "completed", "conclusion": "success"})
    if sandbox:
        # The consumer runs after the protected producer, while this same run is still in progress.
        require(completed or matches_fields(record, {"status": "in_progress", "conclusion": None}), "RUN_SCOPE")
        jobs = get(f"/runs/{run}/attempts/1/jobs").get("jobs")
        require(isinstance(jobs, list) and any(matches_fields(job, {
            "name": "b1-evidence-producer", "run_id": run, "head_sha": workflow_sha,
            "status": "completed", "conclusion": "success",
        }) for job in jobs), "PRODUCER_SCOPE")
    else:
        require(completed, "RUN_SCOPE")
    metadata = get(f"/artifacts/{artifact}")
    require(matches_fields(metadata, {
        "id": artifact, "name": f"{prefix}-{run}-1-{case}",
        "expired": False, "size_in_bytes": len(archive),
    }) and matches_fields(metadata.get("workflow_run"), {
        "id": run, "repository_id": REPO_ID, "head_repository_id": REPO_ID, "head_sha": workflow_sha,
        "head_branch": branch,
    }), "ARTIFACT_SCOPE")
    archive_digest = sha256(archive)
    require(metadata.get("digest") == f"sha256:{archive_digest}", "ARTIFACT_DIGEST")
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            entries = bundle.infolist()
            require(len(entries) == 1, "ARCHIVE_LAYOUT")
            entry = entries[0]
            # No extraction, filesystem paths, extra entries, symlinks or unbounded decompression.
            file_type = stat.S_IFMT(entry.external_attr >> 16)
            require(entry.orig_filename == NAME and entry.filename == NAME and
                    file_type in (0, stat.S_IFREG) and 0 < entry.file_size <= MAX_EVIDENCE and
                    entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) and
                    not (entry.flag_bits & 1), "ARCHIVE_LAYOUT")
            with bundle.open(entry) as item:
                data = item.read(MAX_EVIDENCE + 1)
            require(len(data) == entry.file_size and len(data) <= MAX_EVIDENCE, "EVIDENCE_SIZE")
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, OSError, EOFError, zlib.error):
        raise Rejected("ARCHIVE_INVALID") from None
    evidence = json_object(data)
    identity = {"run": run, "attempt": 1, "sha": sha, "caseId": case, "workflowSha": workflow_sha,
                "productBranch": PRODUCT_BRANCH, "version": 2}
    require(matches_fields(evidence, identity), "EVIDENCE_SCOPE")
    require(evidence.get("kind") == ("organization-sandbox-case" if sandbox else "organization-case"),
            "EVIDENCE_KIND")
    observation_digest = None
    if sandbox:
        scenario, expected = case_files(run, sha, case)
        require(set(evidence) == set(identity) | {"kind", "observation"} and
                json.dumps(evidence.get("observation"), sort_keys=True) == json.dumps(expected, sort_keys=True),
                "SANDBOX_OBSERVATION")
        observation_bytes = json.dumps(evidence["observation"], sort_keys=True, separators=(",", ":")).encode()
        observation_digest = sha256(observation_bytes)
        if window_directory is not None:
            # The original ZIP remains intact. Only verified input reaches the synthetic window.
            directory = Path(window_directory)
            directory.mkdir(mode=0o700)
            (directory / "scenario.json").write_text(json.dumps(scenario), encoding="utf-8")
            (directory / "evidence.json").write_bytes(observation_bytes)
    return {
        "version": 1, "kind": "organization-artifact-transport", "run": run, "attempt": 1,
        "artifact": artifact, "sha": sha, "caseId": case, "archiveSha256": archive_digest,
        "evidenceSha256": sha256(data), "transportVerified": True,
        "workflowSha": workflow_sha, "workflowBranch": branch, "productBranch": PRODUCT_BRANCH,
        "scope": "sandbox" if sandbox else "production", "observationSha256": observation_digest,
        "functionalAcceptanceVerified": False,
    }


def read_archive(path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= MAX_ARCHIVE, "ARCHIVE_SIZE")
        return stream.read(MAX_ARCHIVE + 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, type=int)
    parser.add_argument("--artifact", required=True, type=int)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--workflow-sha", required=True)
    parser.add_argument("--sandbox", action="store_true")
    parser.add_argument("--window-directory")
    parser.add_argument("--case", required=True)
    parser.add_argument("--archive", required=True)
    args = parser.parse_args()
    try:
        result = verify(read_archive(args.archive), args.run, args.artifact, args.sha, args.case,
                        workflow_sha=args.workflow_sha, sandbox=args.sandbox, window_directory=args.window_directory,
                        get=github_client(os.environ.get("MAONO_EVIDENCE_GITHUB_TOKEN")))
    except Rejected as error:
        print(str(error), file=sys.stderr)
        return 1
    except OSError:
        print("ARCHIVE_READ_FAILED", file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
