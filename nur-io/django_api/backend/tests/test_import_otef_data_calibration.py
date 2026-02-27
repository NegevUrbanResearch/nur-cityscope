from django.core.management import call_command
from django.test import TestCase

from backend.models import OTEFViewportState, Table


class ImportCalibrationTests(TestCase):
    def test_import_populates_viewport_state_bounds_and_angle(self):
        # Ensure OTEF table exists so import command can attach calibration.
        Table.objects.create(name="otef", display_name="OTEF")

        # This reads model-bounds.json from the repo (frontend/data path)
        # and should hydrate OTEFViewportState using normalize_calibration_payload.
        call_command("import_otef_data")

        state = OTEFViewportState.objects.get(table__name="otef")
        self.assertIsInstance(state.bounds_polygon, list)
        self.assertGreaterEqual(len(state.bounds_polygon), 3)
        self.assertIsInstance(state.viewer_angle_deg, float)

