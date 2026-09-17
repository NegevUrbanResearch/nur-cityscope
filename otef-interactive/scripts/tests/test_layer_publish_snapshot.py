import tempfile
import unittest
from pathlib import Path

from otef_layer_processing.orchestrator import ProcessingOrchestrator


def _is_under(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


class LayerPublishSnapshotTests(unittest.TestCase):
    def test_publish_snapshot_is_outside_the_processed_output_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            output = root / "processed" / "layers"
            source.mkdir()
            pack = output / "nli"
            pack.mkdir(parents=True)
            (pack / "keep.txt").write_text("x", encoding="utf-8")
            orchestrator = ProcessingOrchestrator(source, output, no_cache=True, max_workers=1)
            snapshot = orchestrator._begin_output_snapshot(["nli"])
            snap_dir = Path(snapshot["dir"])
            processed_root = output.parent
            try:
                self.assertTrue(snap_dir.is_dir())
                self.assertFalse(
                    _is_under(snap_dir, processed_root),
                    f"publish snapshot must not live under {processed_root}: {snap_dir}",
                )
                self.assertTrue((snap_dir / "packs" / "nli" / "keep.txt").is_file())
            finally:
                orchestrator._finish_output_snapshot(snapshot)
            self.assertFalse(snap_dir.exists())
            self.assertEqual(list(processed_root.glob(".layer-publish-*")), [])
