from django.test import TestCase

from backend.models import OTEFViewportState, Table


class OTEFCalibrationStateAPITests(TestCase):
    def test_default_viewer_angle_deg_is_zero(self):
        table = Table.objects.create(
            name='otef',
            display_name='OTEF',
        )
        state = OTEFViewportState.objects.create(table=table)
        self.assertEqual(state.viewer_angle_deg, 0.0)
