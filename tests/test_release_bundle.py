"""Behavior tests for the release gate; all fixtures stay in temporary folders."""

import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
import zlib


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "release_bundle.py"
SPEC = importlib.util.spec_from_file_location("release_bundle", SCRIPT)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


def png(width=128, height=128):
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    raw = (b"\x00" + b"\x2a\x8c\xb9\xff" * width) * height
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


class ReleaseBundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.build = self.base / "build"
        self.build.mkdir()
        self.manifest = {
            "manifest_version": 3,
            "name": "普通人的扩展",
            "description": "把经常使用的文字保存在本机。",
            "version": "1.0.0",
            "icons": {"128": "icons/icon128.png"},
            "action": {"default_popup": "popup.html"},
        }
        self.write("icons/icon128.png", png())
        self.write("popup.html", '<!doctype html><html><script src="scripts/popup.js"></script></html>')
        self.write("scripts/popup.js", 'console.log("Ready");')
        self.save_manifest()

    def write(self, name, content):
        path = self.build / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))

    def save_manifest(self):
        self.write("manifest.json", json.dumps(self.manifest, ensure_ascii=False))

    def check(self, previous_version=None):
        self.save_manifest()
        return release.check_bundle(self.build, previous_version)

    def codes(self, report, level="errors"):
        return {entry["code"] for entry in report[level]}

    def cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True, check=False)

    def test_valid_pack_has_manifest_at_root_hash_and_deterministic_content(self):
        first = self.base / "first.zip"
        report_file = self.base / "release.json"
        result = self.cli("pack", self.build, "--output", first, "--report", report_file)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        report = json.loads(report_file.read_text())
        self.assertEqual(report["status"], "packed")
        self.assertEqual(report["archive"]["sha256"], hashlib.sha256(first.read_bytes()).hexdigest())
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["warnings"], [])
        with zipfile.ZipFile(first) as archive:
            self.assertIn("manifest.json", archive.namelist())
            self.assertNotIn("build/manifest.json", archive.namelist())
            self.assertEqual(archive.namelist(), sorted(archive.namelist()))
            self.assertEqual(archive.read("icons/icon128.png"), png())
            self.assertIsNone(archive.testzip())
        second = self.base / "second.zip"
        self.assertEqual(self.cli("pack", self.build, "--output", second).returncode, 0)
        self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_check_only_does_not_claim_browser_test(self):
        result = self.cli("check", self.build)
        self.assertEqual(result.returncode, 0)
        report = json.loads(result.stdout)
        self.assertEqual(report["status"], "checks_passed")
        self.assertIn("浏览器安装和功能测试", report["checks_scope"]["not_performed"])
        self.assertNotIn("archive", report)

    def test_missing_manifest_resource_blocks_zip_and_writes_report(self):
        self.manifest["background"] = {"service_worker": "missing-worker.js"}
        self.save_manifest()
        output, report_path = self.base / "release.zip", self.base / "checks.json"
        result = self.cli("pack", self.build, "--output", output, "--report", report_path)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(output.exists())
        self.assertIn("missing_resource", self.codes(json.loads(report_path.read_text())))

    def test_missing_html_script_is_detected(self):
        (self.build / "scripts/popup.js").unlink()
        self.assertIn("missing_html_resource", self.codes(self.check()))

    def test_all_common_manifest_resources_and_globs(self):
        for file in ["worker.js", "options.html", "side.html", "devtools.html", "content.js", "content.css", "rules.json", "public/sub/asset.txt", "sandbox.html", "schema.json", "newtab.html"]:
            self.write(file, "{}" if file.endswith(".json") else "")
        self.manifest.update({
            "background": {"service_worker": "worker.js", "type": "module"},
            "options_ui": {"page": "options.html"},
            "side_panel": {"default_path": "side.html"},
            "devtools_page": "devtools.html",
            "content_scripts": [{"matches": ["https://example.com/*"], "js": ["content.js"], "css": ["content.css"]}],
            "web_accessible_resources": [{"resources": ["public/*"], "matches": ["https://example.com/*"]}],
            "declarative_net_request": {"rule_resources": [{"id": "rules", "enabled": True, "path": "rules.json"}]},
            "sandbox": {"pages": ["sandbox.html"]},
            "storage": {"managed_schema": "schema.json"},
            "chrome_url_overrides": {"newtab": "newtab.html"},
        })
        self.assertEqual(self.check()["errors"], [])
        (self.build / "public/sub/asset.txt").unlink()
        self.assertIn("missing_resource", self.codes(self.check()))

    def test_traversal_absolute_backslash_and_encoded_paths_are_rejected(self):
        for path in ["../secret.js", "/etc/passwd", "..\\secret.js", "%2e%2e/secret.js", "C:/secret.js", "https://cdn.example/remote.js"]:
            with self.subTest(path=path):
                self.manifest["background"] = {"service_worker": path}
                self.assertIn("unsafe_resource_path", self.codes(self.check()))

    def test_html_parent_path_inside_bundle_is_allowed_but_escape_is_not(self):
        self.manifest["action"]["default_popup"] = "pages/popup.html"
        self.write("pages/popup.html", '<script src="../scripts/popup.js"></script>')
        self.assertEqual(self.check()["errors"], [])
        self.write("pages/popup.html", '<script src="../../outside.js"></script>')
        self.assertIn("unsafe_resource_path", self.codes(self.check()))

    def test_symlinked_file_and_directory_are_rejected(self):
        outside = self.base / "outside.txt"
        outside.write_text("outside")
        (self.build / "alias.txt").symlink_to(outside)
        (self.build / "linked-dir").symlink_to(self.base, target_is_directory=True)
        self.assertIn("symlink", self.codes(self.check()))
        result = self.cli("pack", self.build, "--output", self.base / "unsafe.zip")
        self.assertEqual(result.returncode, 1)
        self.assertFalse((self.base / "unsafe.zip").exists())

    def test_sensitive_files_block_instead_of_silently_excluding(self):
        self.write(".env.production", "TOKEN=do-not-print-this-value")
        self.write("node_modules/lib/index.js", "")
        self.write(".git/config", "")
        self.write("secrets/key.txt", "-----BEGIN PRIVATE KEY-----\nnot-a-real-key")
        self.manifest["background"] = {"service_worker": "node_modules/lib/index.js"}
        report = self.check()
        self.assertTrue({"sensitive_file", "development_directory", "private_key", "missing_resource"}.issubset(self.codes(report)))
        self.assertNotIn("do-not-print-this-value", json.dumps(report))

    def test_store_icon_requires_128_png_while_other_icons_warn_for_format(self):
        self.write("icons/icon128.png", png(64, 64))
        self.assertIn("icon_dimensions", self.codes(self.check()))
        self.write("icons/icon.ico", b"\x00\x00\x01\x00")
        self.manifest["icons"]["128"] = "icons/icon.ico"
        report = self.check()
        self.assertIn("icon_128_requires_png", self.codes(report))
        self.write("icons/icon128.png", png())
        self.manifest["icons"]["128"] = "icons/icon128.png"
        self.manifest["icons"]["16"] = "icons/icon.ico"
        self.manifest["action"]["default_icon"] = {"128": "icons/icon.ico"}
        report = self.check()
        self.assertEqual(report["errors"], [])
        self.assertIn("icon_format_review", self.codes(report, "warnings"))

    def test_chrome_version_format_and_upgrade_comparison(self):
        for version in ["0", "0.0.0.0", "01", "1.01", "1.2.3.4.5", "1.65536", "1.0-beta", "-1", 1]:
            with self.subTest(version=version):
                self.manifest["version"] = version
                self.assertIn("invalid_version", self.codes(self.check()))
        for version in ["1", "1.0", "0.0.0.1", "65535.65535.65535.65535"]:
            with self.subTest(version=version):
                self.manifest["version"] = version
                self.assertNotIn("invalid_version", self.codes(self.check()))
        self.manifest["version"] = "1.0.0"
        self.assertIn("version_not_increased", self.codes(self.check("1")))
        self.assertIn("version_not_increased", self.codes(self.check("2.0")))
        self.assertIn("invalid_previous_version", self.codes(self.check("last")))
        self.manifest["version"] = "1.0.1"
        self.assertEqual(self.check("1.0")["errors"], [])

    def test_locale_default_required_missing_reference_and_valid_fallback(self):
        self.manifest["name"] = "__MSG_extName__"
        report = self.check()
        self.assertIn("missing_default_locale", self.codes(report))
        self.assertIn("missing_message", self.codes(report))
        self.manifest["default_locale"] = "zh_CN"
        self.write("_locales/zh_CN/messages.json", json.dumps({"extName": {"message": "本地笔记"}}))
        self.write("_locales/en/messages.json", "{}")
        report = self.check()
        self.assertEqual(report["errors"], [])
        self.assertEqual(report["manifest"]["name"], "本地笔记")
        self.write("_locales/zh_CN/messages.json", '{"extName": {"message": 123}}')
        self.assertIn("locale_message", self.codes(self.check()))

    def test_localized_resource_paths_are_checked_after_resolution(self):
        self.manifest["default_locale"] = "en"
        self.manifest["action"]["default_popup"] = "__MSG_popup__"
        self.write("_locales/en/messages.json", '{"popup":{"message":"popup.html"}}')
        self.assertEqual(self.check()["errors"], [])
        self.write("_locales/en/messages.json", '{"popup":{"message":"../outside.html"}}')
        self.assertIn("unsafe_resource_path", self.codes(self.check()))

    def test_remote_images_and_api_data_do_not_become_remote_code(self):
        self.write("popup.html", '<img src="https://images.example/icon.png"><script src="scripts/popup.js"></script>')
        self.write("scripts/popup.js", 'fetch("https://api.example/data").then(r => r.json());\nconst image = "https://images.example/icon.png";')
        report = self.check()
        self.assertEqual(report["errors"], [])
        self.assertNotIn("remote_code_review", self.codes(report, "warnings"))

    def test_remote_code_eval_and_development_addresses_are_review_warnings(self):
        self.write("popup.html", '<script src="https://cdn.example/script.js"></script>')
        self.write("scripts/popup.js", 'import "https://cdn.example/module.js";\nnew Function("return 1");\nfetch("http://localhost:3000");')
        report = self.check()
        self.assertEqual(report["errors"], [])
        self.assertTrue({"remote_code_review", "dynamic_execution_review", "development_endpoint"}.issubset(self.codes(report, "warnings")))

    def test_output_and_report_inside_build_are_rejected(self):
        for args in [("pack", self.build, "--output", self.build / "release.zip"), ("check", self.build, "--report", self.build / "report.json")]:
            with self.subTest(args=args):
                result = self.cli(*args)
                self.assertEqual(result.returncode, 2)
                self.assertFalse(Path(args[-1]).exists())

    def test_existing_zip_requires_explicit_overwrite(self):
        output = self.base / "release.zip"
        output.write_bytes(b"existing release")
        result = self.cli("pack", self.build, "--output", output)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(output.read_bytes(), b"existing release")
        self.assertEqual(self.cli("pack", self.build, "--output", output, "--overwrite").returncode, 0)
        self.assertTrue(zipfile.is_zipfile(output))

    def test_zip_and_report_paths_cannot_collide(self):
        output = self.base / "release.zip"
        for report_path in [output, output / "checks.json"]:
            with self.subTest(report_path=report_path):
                result = self.cli("pack", self.build, "--output", output, "--report", report_path)
                self.assertEqual(result.returncode, 2)
                self.assertFalse(output.exists())

    def test_existing_report_is_not_overwritten_or_followed_through_symlink(self):
        report = self.base / "report.json"
        report.write_text("previous report")
        self.assertEqual(self.cli("check", self.build, "--report", report).returncode, 2)
        self.assertEqual(report.read_text(), "previous report")
        alias = self.base / "alias.json"
        alias.symlink_to(report)
        self.assertEqual(self.cli("check", self.build, "--report", alias, "--overwrite").returncode, 2)
        self.assertEqual(report.read_text(), "previous report")

    def test_failed_check_does_not_overwrite_previous_release_even_when_allowed(self):
        output = self.base / "release.zip"
        output.write_bytes(b"previous release")
        (self.build / "icons/icon128.png").unlink()
        self.assertEqual(self.cli("pack", self.build, "--output", output, "--overwrite").returncode, 1)
        self.assertEqual(output.read_bytes(), b"previous release")

    def test_changed_resource_after_check_cancels_pack(self):
        report = self.check()
        self.write("scripts/popup.js", "changed();")
        output = self.base / "release.zip"
        with self.assertRaises(ValueError):
            release.pack_bundle(report, output)
        self.assertFalse(output.exists())
        self.assertEqual(list(self.base.glob(".extension-release-*.tmp")), [])

    def test_missing_nested_manifest_and_duplicate_json_are_blocked(self):
        (self.build / "manifest.json").rename(self.build / "nested-manifest.json")
        self.assertIn("missing_manifest", self.codes(release.check_bundle(self.build)))
        self.write("manifest.json", '{"manifest_version":3,"manifest_version":2}')
        self.assertIn("invalid_json", self.codes(release.check_bundle(self.build)))
        self.write("manifest.json", '{"manifest_version":3,"some_value":NaN}')
        self.assertIn("invalid_json", self.codes(release.check_bundle(self.build)))

    def test_malformed_common_manifest_fields_do_not_crash(self):
        for key in ["icons", "background", "content_scripts", "web_accessible_resources", "options_ui", "sandbox", "declarative_net_request", "chrome_url_overrides"]:
            with self.subTest(key=key):
                original = dict(self.manifest)
                self.manifest[key] = 42
                self.assertTrue(self.check()["errors"])
                self.manifest = original

    def test_unsafe_cross_platform_archive_names_are_rejected(self):
        self.write("strange\\file.js", "")
        self.write("drive:file.js", "")
        self.assertIn("unsafe_archive_path", self.codes(self.check()))


if __name__ == "__main__":
    unittest.main()
