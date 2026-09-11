"""Meaningful safety and truthfulness checks for local project records."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "project.py"
MODULE_SPEC = importlib.util.spec_from_file_location("launch_project", MODULE_PATH)
project = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(project)


class ProjectRecordsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "example"

    def tearDown(self):
        self.temporary.cleanup()

    def test_init_records_are_formal_but_nothing_is_complete(self):
        project.initialize(self.root, name="句子收藏", idea="保存选中的句子")
        record = self.root / ".extension-launch"
        state = json.loads((record / "state.json").read_text())
        self.assertEqual(state["phase"], "discovery")
        self.assertEqual(state["spec"]["status"], "draft")
        self.assertEqual(state["project"]["target_browser"]["status"], "assumption")
        self.assertEqual(state["project"]["distribution"]["status"], "undecided")
        self.assertEqual(state["project"]["delivery_goal"],
                         {"value": "live", "status": "assumption", "source": "skill_default"})
        self.assertEqual(state["release"]["status"], "not_prepared")
        self.assertEqual(state["record_policy"]["state_role"], "index_only")
        self.assertEqual(state["workflow"]["complexity"]["value"], "undetermined")
        self.assertEqual(state["workflow"]["default_e2e_provider"], "playwright-mcp")
        self.assertEqual(state["workflow"]["complex_chain"], [])
        self.assertEqual(state["workflow"]["parent_ticket"]["status"], "not_published")
        stages = state["workflow"]["required_skill_stages"]
        self.assertTrue({"chrome-extensions", "extension-create", "diagnosing-bugs", "code-review"}
                        <= {stage["skill"] for stage in stages})
        self.assertTrue(all(stage["status"] == "not_executed" and not stage["read_evidence"]
                            and not stage["execution_evidence"] for stage in stages))
        self.assertEqual(len(state["tasks"]), 5)
        for task in state["tasks"]:
            self.assertNotIn(task["status"], ("complete", "done", "closed"))
            document = (record / task["path"]).read_text()
            for field in ("前置依赖", "验收条目", "skills 来源", "规格审查", "关闭条件"):
                self.assertIn(field, document)
            self.assertNotIn("无强制外部技能", document)
            self.assertIn("Playwright MCP", document)
        for milestone in state["milestones"].values():
            self.assertEqual(milestone["status"], "not_started")
            self.assertEqual(milestone["evidence"], [])
        self.assertNotIn(str(MODULE_PATH.parents[1]), (record / "state.json").read_text())

    def test_init_never_overwrites_existing_record_or_project_file(self):
        self.root.mkdir()
        source = self.root / "existing.txt"
        source.write_text("preserve this")
        project.initialize(self.root)
        state_file = self.root / ".extension-launch" / "state.json"
        state_file.write_text("user modified record")
        with self.assertRaises(ValueError):
            project.initialize(self.root, idea="different")
        self.assertEqual(state_file.read_text(), "user modified record")
        self.assertEqual(source.read_text(), "preserve this")

    def test_init_refuses_partial_existing_records(self):
        record = self.root / ".extension-launch"
        record.mkdir(parents=True)
        (record / "spec.md").write_text("existing specification")
        with self.assertRaises(ValueError):
            project.initialize(self.root)
        self.assertFalse((record / "state.json").exists())
        self.assertEqual((record / "spec.md").read_text(), "existing specification")

    def test_browser_argument_is_preserved_without_claiming_distribution(self):
        project.initialize(self.root, browser="firefox")
        state = json.loads((self.root / ".extension-launch/state.json").read_text())
        self.assertEqual(state["project"]["target_browser"]["value"], "firefox")
        self.assertEqual(state["project"]["target_browser"]["status"], "provided")
        self.assertIsNone(state["release"]["channel"])

    def test_complex_cli_plan_requires_native_ticket_skills_without_claiming_execution(self):
        with contextlib.redirect_stdout(io.StringIO()):
            result = project.main(["init", str(self.root), "--complexity", "complex",
                                   "--complexity-reason", "跨页面同步和多个独立模块", "--goal", "local"])
        self.assertEqual(result, 0)
        record = self.root / ".extension-launch"
        state = json.loads((record / "state.json").read_text())
        workflow = state["workflow"]
        self.assertEqual(workflow["complexity"]["value"], "complex")
        self.assertEqual(workflow["complexity"]["reason"], "跨页面同步和多个独立模块")
        self.assertEqual(workflow["complexity"]["decision_owner"], "lead_agent")
        self.assertEqual(workflow["complex_chain"],
                         ["setup-matt-pocock-skills", "to-spec", "publish-parent-ticket", "to-tickets", "implement"])
        self.assertNotIn("triage", workflow["complex_chain"])
        self.assertEqual(workflow["parent_ticket"], {"status": "not_published", "path_or_url": None, "evidence": []})
        self.assertEqual(workflow["authoritative_artifacts"]["implementation_tickets"], [])
        self.assertIsNone(workflow["authoritative_artifacts"]["spec"])
        self.assertEqual(state["spec"]["role"], "coordination_pointer")
        self.assertEqual(state["spec"]["status"], "awaiting_to_spec")
        self.assertNotIn("tasks/*.md", state["record_policy"]["authority"])
        self.assertIn("不是另一份权威规格", (record / "spec.md").read_text())
        self.assertIn("implement", (record / "tasks/T-002.md").read_text())
        self.assertTrue(all(stage["status"] == "not_executed" for stage in workflow["required_skill_stages"]))

    def test_simple_plan_keeps_required_skill_and_e2e_gates(self):
        project.initialize(self.root, complexity="simple", complexity_reason="单页面本地功能")
        record = self.root / ".extension-launch"
        state = json.loads((record / "state.json").read_text())
        self.assertEqual(state["workflow"]["complex_chain"], [])
        self.assertEqual(state["spec"]["role"], "authoritative_local_spec")
        for task_id in ("T-002", "T-003"):
            document = (record / f"tasks/{task_id}.md").read_text()
            self.assertIn("code-review", document)
            self.assertIn("diagnosing-bugs", document)
            self.assertIn("Playwright MCP", document)

    def test_local_goal_does_not_require_publishing(self):
        project.initialize(self.root, goal="local")
        record = self.root / ".extension-launch"
        state = json.loads((record / "state.json").read_text())
        self.assertEqual(state["project"]["delivery_goal"],
                         {"value": "local", "status": "provided", "source": "explicit_cli_argument"})
        tasks = {task["id"]: task for task in state["tasks"]}
        self.assertEqual(tasks["T-001"]["closing_dependencies"], ["T-002", "T-003"])
        for task_id in ("T-004", "T-005"):
            self.assertEqual(tasks[task_id]["status"], "not_in_scope")
            self.assertFalse(tasks[task_id]["in_scope"])
            self.assertTrue((record / tasks[task_id]["path"]).is_file())
        self.assertIn("发布准备与上线跟踪不属于本次交付", (record / "tasks/T-001.md").read_text())
        self.assertIn("商店分发不在范围内", (record / "spec.md").read_text())
        self.assertIn("发布材料：本次范围外", (record / "progress.md").read_text())
        self.assertFalse(state["release"]["preparation_in_scope"])
        self.assertFalse(state["release"]["submission_in_scope"])
        for milestone in state["milestones"].values():
            self.assertEqual(milestone["status"], "not_started")
            self.assertEqual(milestone["evidence"], [])
        self.assertEqual(state["phase"], "discovery")

    def test_materials_cli_goal_keeps_submission_outside_scope(self):
        with contextlib.redirect_stdout(io.StringIO()):
            result = project.main(["init", str(self.root), "--goal", "materials"])
        self.assertEqual(result, 0)
        record = self.root / ".extension-launch"
        state = json.loads((record / "state.json").read_text())
        tasks = {task["id"]: task for task in state["tasks"]}
        self.assertEqual(tasks["T-001"]["closing_dependencies"], ["T-002", "T-003", "T-004"])
        self.assertEqual(tasks["T-004"]["status"], "blocked")
        self.assertEqual(tasks["T-005"]["status"], "not_in_scope")
        self.assertIn("提交与上线跟踪不属于本次交付", (record / "tasks/T-001.md").read_text())
        self.assertIn("发布材料：未准备", (record / "progress.md").read_text())
        self.assertIn("提交审核：本次范围外", (record / "progress.md").read_text())
        self.assertTrue(state["release"]["preparation_in_scope"])
        self.assertFalse(state["release"]["submission_in_scope"])
        self.assertTrue(all(item["status"] == "not_started" and not item["evidence"]
                            for item in state["milestones"].values()))
        self.assertEqual(state["spec"]["status"], "draft")

    def test_init_does_not_infer_publishing_intent_or_create_registration_and_upload_requests(self):
        for goal in (None, "local", "materials", "live"):
            with self.subTest(goal=goal):
                directory = self.root / (goal or "default")
                args = ["init", str(directory), "--idea", "帮我把插件上架"]
                if goal:
                    args.extend(["--goal", goal])
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(project.main(args), 0)
                state = json.loads((directory / ".extension-launch/state.json").read_text())
                release = state["release"]
                self.assertEqual(release["publishing_intent"], {
                    "status": "not_established", "context_evidence": [], "readiness_notice": "not_shown",
                })
                self.assertEqual(release["registration"], {
                    "status": "not_checked", "fee": None, "payment_method_status": "not_checked",
                })
                self.assertEqual(release["assets"], {
                    "status": "not_started", "required_missing": [],
                    "generation_status": "not_attempted", "waiting_for_user_upload": False,
                })
                self.assertEqual(state["needs_user"], [])

    def test_doctor_missing_tools_and_detected_skill_are_not_ready(self):
        skills = Path(self.temporary.name) / "host-skills"
        skill = skills / "example" / "SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("---\nname: example\n---\n# Method")
        # A host config is deliberately outside the metadata paths inspected.
        (skills / "config.json").write_text('{"api_key":"do-not-read"}')
        with patch.object(project.shutil, "which", return_value=None), patch.object(project.platform, "system", return_value="Linux"):
            result = project.doctor(self.root, [skills])
        for command in ("node", "npm", "git"):
            self.assertEqual(result["software"][command]["status"], "missing")
        for browser in result["browsers"].values():
            self.assertEqual(browser["status"], "missing")
            self.assertEqual(browser["connection"], "unverified")
        found = result["external_skills"][0]["skills"][0]
        self.assertEqual(found["status"], "detected")
        self.assertEqual(found["host_activation"], "unverified")
        self.assertEqual(found["invocation"], "unverified")
        self.assertTrue(all(item["status"] == "missing" for item in result["required_skills"]))
        self.assertTrue(all(not item["bundled_substitute_allowed"] for item in result["required_skills"]))
        self.assertIsNone(result["ready_to_develop"])
        self.assertEqual(result["overall"], "requires_runtime_verification")
        self.assertNotIn("do-not-read", project.dump(result))
        self.assertFalse(self.root.exists())

    def test_doctor_matches_lowercase_metadata_and_frontmatter_name_without_claiming_invocation(self):
        skills = Path(self.temporary.name) / "host-skills"
        for directory, filename, name in (("provider-bundle", "skill.md", "chrome-extensions"),
                                          ("extension-create", "SKILL.md", "Extension-Create"),
                                          ("misc", "Skill.md", "diagnosing-bugs"),
                                          ("code-review", "SKILL.md", "code-review")):
            metadata = skills / directory / filename
            metadata.parent.mkdir(parents=True)
            metadata.write_text(f"---\nname: '{name}'\ndescription: fixture\n---\n# Test fixture")
        report = project.doctor(self.root, [skills])
        indexed = {entry["skill"]: entry for entry in report["required_skills"]}
        for name in ("chrome-extensions", "extension-create", "diagnosing-bugs", "code-review"):
            self.assertEqual(indexed[name]["status"], "detected")
            self.assertEqual(indexed[name]["invocation"], "unverified")
            self.assertEqual(indexed[name]["read_evidence"], [])
            self.assertEqual(indexed[name]["execution_evidence"], [])
            self.assertTrue(indexed[name]["source_paths"])
        self.assertEqual(indexed["to-spec"]["status"], "missing")
        self.assertIsNone(report["ready_to_develop"])
        self.assertEqual(report["execution_tools"]["playwright_mcp"], "unverified")

    def test_doctor_report_is_opt_in_and_refuses_overwrite(self):
        report = Path(self.temporary.name) / "report.json"
        report.write_text("keep report")
        with contextlib.redirect_stderr(io.StringIO()), contextlib.redirect_stdout(io.StringIO()):
            result = project.main(["doctor", str(self.root), "--report", str(report)])
        self.assertEqual(result, 1)
        self.assertEqual(report.read_text(), "keep report")

    def test_status_detects_missing_evidence_without_mutating_index(self):
        project.initialize(self.root)
        state_path = self.root / ".extension-launch/state.json"
        state = json.loads(state_path.read_text())
        state["milestones"]["accepted"] = {"status": "complete", "version": "1.0", "evidence": ["evidence/missing.md"]}
        state["milestones"]["live"]["status"] = "complete"
        state_path.write_text(project.dump(state))
        original = state_path.read_bytes()
        result = project.inspect_status(self.root)
        self.assertTrue(any("missing.md" in item for item in result["errors"]))
        self.assertTrue(any("live" in item for item in result["warnings"]))
        self.assertTrue(result["resume_requires_document_and_version_review"])
        self.assertEqual(state_path.read_bytes(), original)

    def test_status_checks_fresh_records_without_claiming_verified_contents(self):
        project.initialize(self.root)
        result = project.inspect_status(self.root)
        self.assertEqual(result["errors"], [])
        self.assertTrue(all(item["exists"] for item in result["files"]))
        self.assertTrue(all(not item["content_verified"] for item in result["files"]))

    def test_status_checks_release_package_and_refuses_outside_evidence(self):
        project.initialize(self.root)
        state_path = self.root / ".extension-launch/state.json"
        state = json.loads(state_path.read_text())
        state["release"]["package"] = "../dist/missing.zip"
        state["release"]["first_use_evidence"] = ["../../outside.md"]
        state_path.write_text(project.dump(state))
        result = project.inspect_status(self.root)
        self.assertTrue(any("missing.zip" in item for item in result["errors"]))
        self.assertTrue(any("超出项目" in item for item in result["errors"]))


if __name__ == "__main__":
    unittest.main()
