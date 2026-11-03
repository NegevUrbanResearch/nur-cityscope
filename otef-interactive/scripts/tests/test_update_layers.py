import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from update_layers import run_update  # noqa: E402


class UpdateLayersTests(unittest.TestCase):
    def test_download_only_refreshes_django_when_running(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls = []

            def fake_run(command, **kwargs):
                calls.append(command)
                if command[:2] == ["docker", "inspect"]:
                    return subprocess.CompletedProcess(command, 0, "true\n", "")
                return subprocess.CompletedProcess(command, 0)

            with patch("update_layers.fetch_latest", return_value=True), patch(
                "update_layers.subprocess.run", side_effect=fake_run
            ):
                run_update(root)

            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[1], ["docker", "compose", "exec", "-T", "nur-api", "python", "manage.py", "import_otef_data", "--layers-only"])

    def test_processing_is_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls = []

            def fake_run(command, **kwargs):
                calls.append(command)
                if command[:2] == ["docker", "inspect"]:
                    return subprocess.CompletedProcess(command, 1, "", "not running")
                return subprocess.CompletedProcess(command, 0)

            with patch("update_layers.fetch_latest", return_value=False), patch(
                "update_layers.subprocess.run", side_effect=fake_run
            ):
                run_update(root, process=True)

            self.assertTrue(any("process_layers.py" in str(item) for command in calls for item in command))
            self.assertFalse(any(command[:3] == ["docker", "compose", "exec"] for command in calls))


if __name__ == "__main__":
    unittest.main()
