from django.test import TestCase

from backend.models import Table, CurationEditRevision


class CurationEditRevisionModelTests(TestCase):
    def setUp(self):
        self.table = Table.objects.create(name="otef", display_name="OTEF")

    def test_revision_rows_are_append_only(self):
        first = CurationEditRevision.objects.create(
            table=self.table,
            project_name="Moresht Axis (ציר מורשת)",
            submission_id="submission-a",
            feature_id="feature-1",
            before_geom={"type": "Point", "coordinates": [34.8, 31.8]},
            after_geom={"type": "Point", "coordinates": [34.81, 31.81]},
        )
        second = CurationEditRevision.objects.create(
            table=self.table,
            project_name="Moresht Axis (ציר מורשת)",
            submission_id="submission-a",
            feature_id="feature-1",
            before_geom={"type": "Point", "coordinates": [34.81, 31.81]},
            after_geom={"type": "Point", "coordinates": [34.82, 31.82]},
        )

        rows = list(
            CurationEditRevision.objects.filter(
                table=self.table, feature_id="feature-1"
            ).order_by("-created_at")
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].id, second.id)
        self.assertEqual(rows[1].id, first.id)

    def test_revision_captures_before_after_geometry(self):
        row = CurationEditRevision.objects.create(
            table=self.table,
            project_name="Moresht Axis (ציר מורשת)",
            submission_id="submission-b",
            feature_id="feature-2",
            before_geom={"type": "Point", "coordinates": [34.7, 31.7]},
            after_geom={"type": "Point", "coordinates": [34.9, 31.9]},
            reason="manual adjustment",
        )
        self.assertEqual(row.before_geom["coordinates"], [34.7, 31.7])
        self.assertEqual(row.after_geom["coordinates"], [34.9, 31.9])
        self.assertEqual(row.reason, "manual adjustment")
