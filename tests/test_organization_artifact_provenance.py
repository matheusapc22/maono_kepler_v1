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
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("artifact_verifier", SCRIPT)
v = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(v)


class ProvenanceTests(unittest.TestCase):
    RUN = 71
    ARTIFACT = 92
    SHA = "a" * 40
    WORKFLOW_SHA = "c" * 40
    CASE = "organization-update"

    def setUp(self):
        source = {"id": v.REPO_ID, "full_name": v.REPO}
        self.content = {"run": self.RUN, "attempt": 1, "sha": self.SHA, "caseId": self.CASE,
                        "workflowSha": self.WORKFLOW_SHA, "version": 2, "kind": "organization-case",
                        "productBranch": v.PRODUCT_BRANCH}
        self.run = {
            "id": self.RUN, "run_attempt": 1, "head_sha": self.WORKFLOW_SHA, "head_branch": v.BRANCH,
            "event": "workflow_dispatch", "status": "completed", "conclusion": "success",
            "path": v.WORKFLOW_PATH, "repository": source, "head_repository": source,
        }
        self.artifact = {
            "id": self.ARTIFACT, "name": f"organization-evidence-{self.RUN}-1-{self.CASE}", "expired": False,
            "workflow_run": {"id": self.RUN, "repository_id": v.REPO_ID,
                             "head_repository_id": v.REPO_ID, "head_sha": self.WORKFLOW_SHA, "head_branch": v.BRANCH},
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
        return v.verify(self.archive, self.RUN, self.ARTIFACT, self.SHA, self.CASE, workflow_sha=self.WORKFLOW_SHA, get=self.get)

    def test_transport_proof_does_not_promote_functional_acceptance(self):
        result = self.verify()
        self.assertTrue(result["transportVerified"])
        self.assertFalse(result["functionalAcceptanceVerified"])
        self.assertEqual(result["evidenceSha256"], v.sha256(json.dumps(self.content).encode()))

    def test_sandbox_cli_to_two_original_archives_and_normal_window(self):
        for case in v.CASES:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                argv = [sys.executable, str(SCRIPT.with_name("produce-organization-artifact.py")),
                        "--directory", directory, "--run", str(self.RUN), "--sha", self.SHA,
                        "--workflow-sha", self.WORKFLOW_SHA, "--case", case]
                subprocess.run(argv, check=True, capture_output=True)
                self.assertNotEqual(subprocess.run(argv, capture_output=True).returncode, 0)
                raw = (Path(directory) / v.NAME).read_bytes()
                self.archive = self.bundle(raw)
                self.pin()
                self.artifact["name"] = f"b1-test-case-{self.RUN}-1-{case}"
                self.run.update(head_branch=v.WORKFLOW_BRANCH, status="in_progress", conclusion=None)
                self.artifact["workflow_run"]["head_branch"] = v.WORKFLOW_BRANCH
                job = {"name": "b1-evidence-producer", "status": "completed", "conclusion": "success",
                       "run_id": self.RUN, "head_sha": self.WORKFLOW_SHA}
                def get(endpoint):
                    if endpoint == f"/runs/{self.RUN}/attempts/1/jobs":
                        return {"jobs": [job]}
                    return self.get(endpoint)
                def verify(c=case, output=None):
                    return v.verify(self.archive, self.RUN, self.ARTIFACT, self.SHA, c,
                                    workflow_sha=self.WORKFLOW_SHA, sandbox=True, get=get, window_directory=output)
                with patch.dict(job, {"conclusion": "failure"}), self.assertRaisesRegex(v.Rejected, "PRODUCER_SCOPE"):
                    verify()
                with self.assertRaisesRegex(v.Rejected, "ARTIFACT_SCOPE"):
                    verify(next(c for c in v.CASES if c != case))
                with self.assertRaisesRegex(v.Rejected, "RUN_SCOPE"):
                    self.verify()
                with patch.dict(self.artifact["workflow_run"], {"id": self.RUN+1}), self.assertRaisesRegex(v.Rejected, "ARTIFACT_SCOPE"):
                    verify()
                target = Path(directory) / "window"
                receipt = verify(output=target)
                self.assertEqual(receipt["evidenceSha256"], v.sha256(raw))
                self.assertEqual(receipt["observationSha256"], v.sha256((target / "evidence.json").read_bytes()))
                self.assertFalse(receipt["functionalAcceptanceVerified"])
                consumer = SCRIPT.with_name("operator.mjs")
                result = subprocess.run(["node", str(consumer), "organization-window-synthetic",
                                         str(target/"scenario.json"), str(target/"evidence.json")],
                                        check=True, capture_output=True)
                self.assertTrue(json.loads(result.stdout)["protocolComplete"])
                self.assertFalse(json.loads(result.stdout)["acceptanceExecuted"])
                payload = json.loads(raw)
                for field, value, rejection in (("run", self.RUN+1, "EVIDENCE_SCOPE"),
                                                ("attempt", 2, "EVIDENCE_SCOPE"),
                                                ("sha", "b"*40, "EVIDENCE_SCOPE"),
                                                ("workflowSha", "e"*40, "EVIDENCE_SCOPE"),
                                                ("productBranch", "main", "EVIDENCE_SCOPE"),
                                                ("observation", {}, "SANDBOX_OBSERVATION")):
                    with self.subTest(field=field):
                        self.archive = self.bundle({**payload, field: value})
                        self.pin()
                        with self.assertRaisesRegex(v.Rejected, rejection):
                            verify()

    def test_legacy_synthetic_producer_still_emits_only_original_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            argv = [sys.executable, str(SCRIPT.with_name("produce-organization-artifact.py")),
                    "--run", str(self.RUN), "--sha", self.SHA, "--directory", directory]
            subprocess.run(argv, check=True, capture_output=True)
            raw = json.loads((Path(directory) / v.NAME).read_bytes())
            self.assertEqual(raw, {"version": 1, "kind": "organization-synthetic-transport-fixture",
                                   "run": self.RUN, "attempt": 1, "sha": self.SHA,
                                   "caseId": "synthetic-organization-update"})
            self.assertNotEqual(subprocess.run(argv + ["--session", "fixture"], capture_output=True).returncode, 0)

    def test_wrong_attempt_ref_sha_workflow_event_conclusion_or_repository_refused(self):
        for field, mismatch in {
            "run_attempt": 2, "head_branch": "feature", "head_sha": "b" * 40,
            "path": ".github/workflows/another.yml", "event": "pull_request", "conclusion": "failure",
            "head_repository": {"id": 999, "full_name": "other/repo"},
        }.items():
            with self.subTest(field=field), patch.dict(self.run, {field: mismatch}):
                with self.assertRaisesRegex(v.Rejected, "RUN_SCOPE"):
                    self.verify()

    def test_independent_pins_refuse_product_or_workflow_drift(self):
        self.assertNotEqual(self.WORKFLOW_SHA, self.SHA)
        self.assertEqual(self.verify()["workflowBranch"], "main")
        with patch.dict(self.run, {"head_sha": self.SHA}), self.assertRaisesRegex(v.Rejected, "RUN_SCOPE"):
            self.verify()
        for key, wrong in (("sha", self.WORKFLOW_SHA), ("workflowSha", self.SHA),
                           ("productBranch", v.BRANCH), ("run", self.RUN + 1), ("attempt", 2)):
            with self.subTest(key=key):
                self.archive = self.bundle({**self.content, key: wrong})
                self.pin()
                with self.assertRaisesRegex(v.Rejected, "EVIDENCE_SCOPE"):
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
                    "--sha", self.SHA, "--workflow-sha", self.WORKFLOW_SHA, "--case", self.CASE, "--archive", str(path)]
            with patch("sys.argv", argv), patch.object(v, "github_client", return_value=self.get), \
                    patch("sys.stdout", io.StringIO()) as output:
                self.assertEqual(v.main(), 0)
                self.assertEqual(json.loads(output.getvalue())["artifact"], self.ARTIFACT)


class RecoveryTests(unittest.TestCase):
    def test_only_interrupted_original_gate_can_recover_and_success_ends_recovery(self):
        spec = importlib.util.spec_from_file_location("recovery", SCRIPT.with_name("b1-recovery-guard.py"))
        recovery = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(recovery)
        sha = "1" * 40
        job = {"run_id": 71, "name": "b1-cloudflare", "head_sha": sha, "status": "completed",
               "conclusion": "cancelled", "steps": [{"name": recovery.CHECK, "conclusion": "success"},
               {"name": recovery.MUTATION, "conclusion": "cancelled", "started_at": "2026-01-01T01:00:00Z"}]}
        self.assertTrue(recovery.recovery_allowed([[job]], sha, 71))
        self.assertTrue(recovery.recovery_allowed([[job], [job]], sha, 71))
        for history in ([], [[]], [[dict(job, run_id=72)]], [[dict(job, steps=[])]],
                        [[dict(job, head_sha="2"*40)]], [[job], [dict(job, conclusion="success")]]):
            self.assertFalse(recovery.recovery_allowed(history, sha, 71))


if __name__ == "__main__":
    unittest.main()
