import copy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/acceptance/verify-organization-artifact.py"
SPEC = importlib.util.spec_from_file_location("artifact_verifier", SCRIPT)
v = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(v)


class ProvenanceTests(unittest.TestCase):
    RUN = 71
    ARTIFACT = 92
    SHA = "a" * 40
    CASE = "organization-update"

    def setUp(self):
        source = {"id": v.REPO_ID, "full_name": v.REPO}
        self.content = {"run": self.RUN, "attempt": 1, "sha": self.SHA, "caseId": self.CASE}
        self.run = {
            "id": self.RUN, "run_attempt": 1, "head_sha": self.SHA, "head_branch": v.BRANCH,
            "event": "workflow_dispatch", "status": "completed", "conclusion": "success",
            "path": v.WORKFLOW_PATH, "repository": source, "head_repository": source,
        }
        self.artifact = {
            "id": self.ARTIFACT, "name": f"organization-evidence-{self.RUN}-1-{self.CASE}", "expired": False,
            "workflow_run": {"id": self.RUN, "repository_id": v.REPO_ID,
                             "head_repository_id": v.REPO_ID, "head_sha": self.SHA, "head_branch": v.BRANCH},
        }
        self.archive = self.bundle(self.content)
        self.pin()

    def bundle(self, evidence, *, name=v.NAME, other=False):
        target = io.BytesIO()
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr(name, evidence if isinstance(evidence, bytes) else json.dumps(evidence))
            if other:
                bundle.writestr("another.json", "{}")
        return target.getvalue()

    def pin(self):
        self.artifact.update(digest=f"sha256:{v.sha256(self.archive)}", size_in_bytes=len(self.archive))

    def get(self, endpoint):
        return copy.deepcopy({f"/runs/{self.RUN}": self.run, f"/artifacts/{self.ARTIFACT}": self.artifact}[endpoint])

    def verify(self):
        return v.verify(self.archive, self.RUN, self.ARTIFACT, self.SHA, self.CASE, get=self.get)

    def test_transport_proof_does_not_promote_functional_acceptance(self):
        result = self.verify()
        self.assertTrue(result["transportVerified"])
        self.assertFalse(result["functionalAcceptanceVerified"])
        self.assertEqual(result["evidenceSha256"], v.sha256(json.dumps(self.content).encode()))

    def test_producer_cli_to_zip_to_transport_verifier(self):
        case = "synthetic-organization-update"
        producer = SCRIPT.with_name("produce-organization-artifact.py")
        with tempfile.TemporaryDirectory() as directory:
            argv = [sys.executable, str(producer), "--directory", directory,
                    "--run", str(self.RUN), "--sha", self.SHA]
            subprocess.run(argv, check=True, capture_output=True)
            self.assertNotEqual(subprocess.run(argv, capture_output=True).returncode, 0)
            with self.assertRaises(subprocess.CalledProcessError):
                subprocess.run(argv + ["--session", "synthetic-secret"], check=True, capture_output=True)
            raw = (Path(directory) / v.NAME).read_bytes()
        self.assertEqual(json.loads(raw), {
            **self.content, "caseId": case, "version": 1,
            "kind": "organization-synthetic-transport-fixture",
        })
        self.archive = self.bundle(raw)
        self.pin()
        self.artifact["name"] = f"organization-evidence-{self.RUN}-1-{case}"
        receipt = v.verify(self.archive, self.RUN, self.ARTIFACT, self.SHA, case, get=self.get)
        self.assertEqual(receipt["evidenceSha256"], v.sha256(raw))
        self.assertTrue(receipt["transportVerified"])
        self.assertFalse(receipt["functionalAcceptanceVerified"])

    def test_wrong_attempt_ref_sha_workflow_event_conclusion_or_repository_refused(self):
        for field, mismatch in {
            "run_attempt": 2, "head_branch": "feature", "head_sha": "b" * 40,
            "path": ".github/workflows/another.yml", "event": "pull_request", "conclusion": "failure",
            "head_repository": {"id": 999, "full_name": "other/repo"},
        }.items():
            with self.subTest(field=field), patch.dict(self.run, {field: mismatch}):
                with self.assertRaisesRegex(v.Rejected, "RUN_SCOPE"):
                    self.verify()

    def test_expired_or_unlinked_artifact_refused(self):
        with patch.dict(self.artifact, {"expired": True}):
            with self.assertRaisesRegex(v.Rejected, "ARTIFACT_SCOPE"):
                self.verify()
        with patch.dict(self.artifact["workflow_run"], {"id": self.RUN + 1}):
            with self.assertRaisesRegex(v.Rejected, "ARTIFACT_SCOPE"):
                self.verify()

    def test_modified_archive_rejected_even_if_size_is_unchanged(self):
        self.archive = self.archive[:-1] + bytes([self.archive[-1] ^ 1])
        with self.assertRaisesRegex(v.Rejected, "ARTIFACT_DIGEST"):
            self.verify()

    def test_wrong_case_or_duplicate_fields_rejected(self):
        for payload, code in [
            ({**self.content, "caseId": "other"}, "EVIDENCE_SCOPE"),
            (b'{"run":1,"run":2}', "DUPLICATE_JSON_FIELD"),
        ]:
            with self.subTest(code=code):
                self.archive = self.bundle(payload)
                self.pin()
                with self.assertRaisesRegex(v.Rejected, code):
                    self.verify()

    def test_wrong_path_extra_entry_and_unbounded_inflation_rejected(self):
        for archive in [
            self.bundle(self.content, name="../organization-evidence.json"),
            self.bundle(self.content, other=True),
            self.bundle(b"x" * (v.MAX_EVIDENCE + 1)),
        ]:
            self.archive = archive
            self.pin()
            with self.assertRaisesRegex(v.Rejected, "ARCHIVE_LAYOUT"):
                self.verify()

    def test_http_client_gets_only_pinned_host_and_endpoints(self):
        class Opener:
            def open(self, request, *, timeout):
                self.request, self.timeout = request, timeout
                return io.BytesIO(b'{"ok":true}')

        opener = Opener()
        get = v.github_client("test-token".ljust(24, "x"), opener)
        self.assertEqual(get("/runs/71"), {"ok": True})
        self.assertEqual(opener.request.full_url, v.API_ROOT + "/runs/71")
        self.assertEqual(opener.request.method, "GET")
        self.assertEqual(opener.timeout, 10)
        with self.assertRaisesRegex(v.Rejected, "API_SCOPE"):
            get("/artifacts/71/zip")
        self.assertIsNone(v.NoRedirect().redirect_request(None, None, 302, None, None, "https://other.invalid"))

    def test_main_outputs_only_sanitized_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "evidence.zip"
            path.write_bytes(self.archive)
            argv = [str(SCRIPT), "--run", str(self.RUN), "--artifact", str(self.ARTIFACT),
                    "--sha", self.SHA, "--case", self.CASE, "--archive", str(path)]
            with patch("sys.argv", argv), patch.object(v, "github_client", return_value=self.get), \
                    patch("sys.stdout", io.StringIO()) as output:
                self.assertEqual(v.main(), 0)
                self.assertEqual(json.loads(output.getvalue())["artifact"], self.ARTIFACT)


if __name__ == "__main__":
    unittest.main()
