import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from segev_web_export import export_slides  # noqa: E402


class SegevWebExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "nur-model.pdf"
        self.source.write_bytes(b"%PDF-1.7\n")
        self.output = self.root / "segev-web"

    def tearDown(self):
        self.temp.cleanup()

    def test_renders_first_eight_pdf_pages_without_opening_libreoffice(self):
        def run(args, **_kwargs):
            prefix = Path(args[-1])
            for page in range(1, 9):
                prefix.with_name(f"slide-{page:02}.png").write_bytes(b"png")

        with patch("segev_web_export.subprocess.run", side_effect=run) as run_process:
            results = export_slides(self.source, self.output, "pdftoppm")

        self.assertEqual([path.name for path in results], [f"slide-{n:02}.png" for n in range(1, 9)])
        run_process.assert_called_once()
        command = run_process.call_args.args[0]
        self.assertEqual(command[0], "pdftoppm")
        self.assertEqual(command[command.index("-f") + 1], "1")
        self.assertEqual(command[command.index("-l") + 1], "8")
        self.assertNotIn("soffice", command)
        self.assertEqual(len(list(self.output.glob("*.png"))), 8)

    def test_rejects_non_pdf_source_before_running_a_converter(self):
        self.source.write_bytes(b"not a PDF")
        with patch("segev_web_export.subprocess.run") as run_process:
            with self.assertRaisesRegex(ValueError, "PDF"):
                export_slides(self.source, self.output, "pdftoppm")
        run_process.assert_not_called()


if __name__ == "__main__":
    unittest.main()
