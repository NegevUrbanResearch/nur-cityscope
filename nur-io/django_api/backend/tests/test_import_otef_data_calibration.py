from django.core.management import call_command
from django.test import TestCase

from backend.models import LayerState, OTEFViewportState, Table


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

    def test_import_removes_only_retired_nli_layer_states(self):
        table = Table.objects.create(name="otef", display_name="OTEF")
        LayerState.objects.create(table=table, layer_id="nli.nli_catalog", enabled=True)
        LayerState.objects.create(table=table, layer_id="nli.oct7_database", enabled=True)
        retained = LayerState.objects.create(table=table, layer_id="nli.people", enabled=True)

        call_command("import_otef_data")

        self.assertFalse(LayerState.objects.filter(table=table, layer_id="nli.nli_catalog").exists())
        self.assertFalse(LayerState.objects.filter(table=table, layer_id="nli.oct7_database").exists())
        self.assertTrue(LayerState.objects.filter(pk=retained.pk).exists())
