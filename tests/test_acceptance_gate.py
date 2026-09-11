"""The gate rejects missing, simulated, stale and unsafe acceptance evidence.

Fixtures only test the checker. They are synthetic records and are never
distributed as evidence that a real extension was accepted.
"""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "acceptance_gate.py"
MODULE_SPEC = importlib.util.spec_from_file_location("acceptance_gate", MODULE_PATH)
gate = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(gate)


class AcceptanceGateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.build = self.root / "extension"
        self.build.mkdir()
        (self.build / "manifest.json").write_text('{"manifest_version":3,"name":"Fixture","version":"1.0.0"}')
        (self.build / "popup.html").write_text('<script src="popup.js"></script>')
        (self.build / "popup.js").write_text("document.body.dataset.ready = 'true';")
        (self.build / "icon.png").write_bytes(b"synthetic test asset")
        (self.build / "module.mjs").write_text("export const fixture = true;")
        self.evidence = self.root / "evidence" / "acceptance.json"
        (self.evidence.parent / "browser").mkdir(parents=True)
        (self.evidence.parent / "browser" / "record.log").write_text("Synthetic checker fixture. Not real acceptance evidence.")
        self.report = {
            "schema_version": 1,
            "candidate": gate.fingerprint_build(self.build),
            "environment": {"browser_name": "Chrome", "browser_version": "140.0.0.0",
                            "extension_id": "abcdefghijklmnopabcdefghijklmnop", "installation_type": "unpacked",
                            "automation_provider": "playwright-mcp"},
            "required_scenarios": sorted(gate.REQUIRED_SCENARIOS),
            "scenarios": [
                {"id": scenario, "required": True, "status": "passed", "method": "real_browser_tool",
                 "steps": ["Load the extension", "Perform the specified actual browser operation"],
                 "expected": "The observed browser result matches the specified outcome.",
                 "actual": "Recorded observed outcome.", "artifactPaths": ["browser/record.log"],
                 **({"entry_kind": "native_action"} if scenario == "native_entry" else {})}
                for scenario in sorted(gate.REQUIRED_SCENARIOS)
            ],
        }

    def tearDown(self):
        self.temporary.cleanup()

    def write_report(self):
        self.evidence.write_text(gate.json_text(self.report))

    def check(self):
        self.write_report()
        return gate.check_acceptance(self.build, self.evidence)

    def test_complete_record_matches_candidate_without_authenticating_claims(self):
        result = self.check()
        self.assertTrue(result["gate_passed"], result["errors"])
        self.assertFalse(result["claims_authenticated"])
        self.assertFalse(result["state_updated"])
        self.assertEqual(result["checked_artifacts"], 1)
        self.assertEqual({item["path"] for item in self.report["candidate"]["files"]},
                         {"manifest.json", "popup.html", "popup.js", "icon.png", "module.mjs"})

    def test_missing_report_and_missing_environment_are_rejected(self):
        result = gate.check_acceptance(self.build, self.evidence)
        self.assertFalse(result["gate_passed"])
        self.report["environment"]["extension_id"] = ""
        self.assertFalse(self.check()["gate_passed"])

    def test_missing_unknown_and_simulated_provider_are_rejected(self):
        for provider in (None, "playwright", "mock", "witnessed-manual", [], {}):
            with self.subTest(provider=provider):
                self.report["environment"]["automation_provider"] = provider
                result = self.check()
                self.assertFalse(result["gate_passed"])
                self.assertTrue(any("automation_provider" in error for error in result["errors"]))
        del self.report["environment"]["automation_provider"]
        self.assertFalse(self.check()["gate_passed"])

    def alternative_choice(self, provider="controlled-browser"):
        self.report["environment"]["automation_provider"] = provider
        (self.evidence.parent / "user-choice.md").write_text("Synthetic fixture: user selected controlled alternative after a missing MCP was explained.")
        self.report["browser_choice"] = {
            "default_provider": "playwright-mcp", "selected_provider": provider,
            "reason": "The host does not expose a Playwright MCP server capable of installing extensions.",
            "user_decision": {"status": "approved", "evidence_path": "user-choice.md"},
        }

    def test_fallback_requires_approved_user_choice_and_nonempty_original_evidence(self):
        self.report["environment"]["automation_provider"] = "controlled-browser"
        self.assertFalse(self.check()["gate_passed"])
        self.alternative_choice()
        self.report["browser_choice"]["user_decision"]["status"] = "pending"
        self.assertFalse(self.check()["gate_passed"])
        self.report["browser_choice"]["user_decision"]["status"] = "approved"
        self.report["browser_choice"]["user_decision"]["evidence_path"] = "missing.md"
        self.assertFalse(self.check()["gate_passed"])
        self.report["browser_choice"]["user_decision"]["evidence_path"] = "user-choice.md"
        (self.evidence.parent / "user-choice.md").write_text("")
        self.assertFalse(self.check()["gate_passed"])

    def test_each_real_alternative_accepts_matching_user_choice_without_certifying_claims(self):
        for provider in ("controlled-browser", "chrome-devtools-mcp", "browser-mcp"):
            with self.subTest(provider=provider):
                self.alternative_choice(provider)
                result = self.check()
                self.assertTrue(result["gate_passed"], result["errors"])
                self.assertFalse(result["claims_authenticated"])
                self.assertEqual(result["checked_artifacts"], 2)

    def test_browser_choice_cannot_mismatch_provider_or_reuse_its_summary_as_evidence(self):
        self.alternative_choice()
        for field, value in (("default_provider", "browser-mcp"), ("selected_provider", "browser-mcp"), ("reason", "")):
            with self.subTest(field=field):
                previous = self.report["browser_choice"][field]
                self.report["browser_choice"][field] = value
                self.assertFalse(self.check()["gate_passed"])
                self.report["browser_choice"][field] = previous
        self.report["browser_choice"]["user_decision"]["evidence_path"] = "acceptance.json"
        self.assertFalse(self.check()["gate_passed"])
        self.report["browser_choice"]["user_decision"]["evidence_path"] = "../outside.md"
        self.assertFalse(self.check()["gate_passed"])

    def test_witnessed_manual_cannot_bypass_provider_or_user_choice(self):
        for scenario in self.report["scenarios"]:
            scenario["method"] = "witnessed_manual"
        self.report["environment"]["automation_provider"] = "controlled-browser"
        self.assertFalse(self.check()["gate_passed"])
        self.alternative_choice()
        self.assertTrue(self.check()["gate_passed"])
        del self.report["environment"]["automation_provider"]
        self.assertFalse(self.check()["gate_passed"])

    def test_static_and_mock_methods_cannot_substitute_for_browser_checks(self):
        for method in ("static", "mock", "unit_test", "unverified"):
            with self.subTest(method=method):
                self.report["scenarios"][0]["method"] = method
                self.assertFalse(self.check()["gate_passed"])

    def test_native_entry_is_required_and_direct_popup_is_rejected(self):
        native = next(item for item in self.report["scenarios"] if item["id"] == "native_entry")
        native["entry_kind"] = "direct_popup_html"
        self.assertFalse(self.check()["gate_passed"])
        self.report["scenarios"].remove(native)
        self.report["required_scenarios"].remove("native_entry")
        result = self.check()
        self.assertFalse(result["gate_passed"])
        self.assertTrue(any("native_entry" in error for error in result["errors"]))

    def test_changed_added_and_deleted_candidate_files_invalidate_record(self):
        self.write_report()
        (self.build / "popup.js").write_text("changed implementation")
        (self.build / ".hidden-runtime-file").write_text("new runtime file")
        (self.build / "icon.png").unlink()
        result = gate.check_acceptance(self.build, self.evidence)
        self.assertFalse(result["gate_passed"])
        self.assertTrue(any("popup.js" in error and ".hidden-runtime-file" in error and "icon.png" in error
                            for error in result["errors"]))

    def test_required_failure_and_missing_steps_are_rejected(self):
        self.report["scenarios"][0]["status"] = "failed"
        self.assertFalse(self.check()["gate_passed"])
        self.report["scenarios"][0]["status"] = "passed"
        self.report["scenarios"][0]["steps"] = []
        self.assertFalse(self.check()["gate_passed"])

    def test_additional_project_scenario_is_required_and_must_pass(self):
        self.report["required_scenarios"].append("delete_saved_item")
        self.assertFalse(self.check()["gate_passed"])
        self.report["scenarios"].append({"id": "delete_saved_item", "required": True,
                                         "status": "failed", "method": "real_browser_tool",
                                         "steps": ["Delete an item"], "expected": "Item gone", "actual": "Item remained",
                                         "artifactPaths": ["browser/record.log"]})
        self.assertFalse(self.check()["gate_passed"])

    def test_evidence_escape_absolute_paths_and_symlinks_are_rejected(self):
        secret = self.root / "outside.log"
        secret.write_text("must not be read")
        alias = self.evidence.parent / "browser" / "alias.log"
        alias.symlink_to(secret)
        for path in ("../outside.log", str(secret), "browser/alias.log", "C:\\private\\data.txt"):
            with self.subTest(path=path):
                self.report["scenarios"][0]["artifactPaths"] = [path]
                self.assertFalse(self.check()["gate_passed"])

    def test_missing_and_empty_artifacts_are_rejected(self):
        for content in (None, ""):
            with self.subTest(content=content):
                artifact = self.evidence.parent / "browser" / "record.log"
                if content is None:
                    artifact.unlink()
                else:
                    artifact.write_text(content)
                self.assertFalse(self.check()["gate_passed"])

    def test_acceptance_report_cannot_serve_as_its_own_browser_artifact(self):
        self.report["scenarios"][0]["artifactPaths"] = ["acceptance.json"]
        self.assertFalse(self.check()["gate_passed"])

    def test_symlink_in_build_is_rejected(self):
        (self.build / "alias.js").symlink_to(self.build / "popup.js")
        self.assertFalse(self.check()["gate_passed"])

    def test_witnessed_manual_metadata_is_allowed_but_still_not_certified(self):
        for scenario in self.report["scenarios"]:
            scenario["method"] = "witnessed_manual"
        result = self.check()
        self.assertTrue(result["gate_passed"], result["errors"])
        self.assertFalse(result["claims_authenticated"])

    def test_cli_does_not_overwrite_report_or_modify_evidence(self):
        self.write_report()
        old_evidence = self.evidence.read_bytes()
        output = self.root / "gate.json"
        args = ["check", str(self.build), "--evidence", str(self.evidence), "--report", str(output)]
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(gate.main(args), 0)
            old_output = output.read_bytes()
            self.assertEqual(gate.main(args), 1)
        self.assertEqual(output.read_bytes(), old_output)
        self.assertEqual(self.evidence.read_bytes(), old_evidence)


if __name__ == "__main__":
    unittest.main()
