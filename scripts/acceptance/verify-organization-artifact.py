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

REPO = "matheusapc22/maono_kepler_v1"
REPO_ID = 1051393010
BRANCH = "mano_kepler_v1"
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
        # Only numeric identifiers and these two read-only endpoints are ever used.
        require(re.fullmatch(r"/(?:runs|artifacts)/[1-9][0-9]{0,15}", endpoint), "API_SCOPE")
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


def verify(archive, run, artifact, sha, case, *, get):
    validate_target(run, artifact, sha, case)
    require(0 < len(archive) <= MAX_ARCHIVE, "ARCHIVE_SIZE")
    record = get(f"/runs/{run}")
    require(matches_fields(record, {
        "id": run, "run_attempt": 1, "head_sha": sha, "head_branch": BRANCH,
        "event": "workflow_dispatch", "status": "completed", "conclusion": "success", "path": WORKFLOW_PATH,
    }) and matches_fields(record.get("repository"), {"id": REPO_ID, "full_name": REPO})
        and matches_fields(record.get("head_repository"), {"id": REPO_ID, "full_name": REPO}), "RUN_SCOPE")
    metadata = get(f"/artifacts/{artifact}")
    require(matches_fields(metadata, {
        "id": artifact, "name": f"organization-evidence-{run}-1-{case}",
        "expired": False, "size_in_bytes": len(archive),
    }) and matches_fields(metadata.get("workflow_run"), {
        "id": run, "repository_id": REPO_ID, "head_repository_id": REPO_ID, "head_sha": sha,
        "head_branch": BRANCH,
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
    require(matches_fields(evidence, {"run": run, "attempt": 1, "sha": sha, "caseId": case}), "EVIDENCE_SCOPE")
    return {
        "version": 1, "kind": "organization-artifact-transport", "run": run, "attempt": 1,
        "artifact": artifact, "sha": sha, "caseId": case, "archiveSha256": archive_digest,
        "evidenceSha256": sha256(data), "transportVerified": True,
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
    parser.add_argument("--case", required=True)
    parser.add_argument("--archive", required=True)
    args = parser.parse_args()
    try:
        result = verify(read_archive(args.archive), args.run, args.artifact, args.sha, args.case,
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
