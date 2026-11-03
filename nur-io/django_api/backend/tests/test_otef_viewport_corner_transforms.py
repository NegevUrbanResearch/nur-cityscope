from django.test import SimpleTestCase

from backend.models import OTEFViewportState


class OTEFViewportCornerTransformTests(SimpleTestCase):
    def make_state(self):
        state = OTEFViewportState()
        state.viewport = {
            "bbox": [100, 100, 700, 700],
            "zoom": 14,
            "corners": {
                "sw": {"x": 120, "y": 120},
                "se": {"x": 640, "y": 90},
                "nw": {"x": 140, "y": 720},
                "ne": {"x": 710, "y": 690},
            },
        }
        return state

    def test_pan_translates_existing_skewed_corners(self):
        viewport = self.make_state().apply_pan_command("east", 0.1)

        self.assertEqual(viewport["bbox"], [160, 100, 760, 700])
        self.assertEqual(
            viewport["corners"],
            {
                "sw": {"x": 180, "y": 120},
                "se": {"x": 700, "y": 90},
                "nw": {"x": 200, "y": 720},
                "ne": {"x": 770, "y": 690},
            },
        )

    def test_zoom_scales_existing_skewed_corners_around_bbox_center(self):
        viewport = self.make_state().apply_zoom_command(15)

        self.assertEqual(viewport["bbox"], [250, 250, 550, 550])
        self.assertEqual(
            viewport["corners"],
            {
                "sw": {"x": 260, "y": 260},
                "se": {"x": 520, "y": 245},
                "nw": {"x": 270, "y": 560},
                "ne": {"x": 555, "y": 545},
            },
        )
