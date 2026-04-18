import uuid
from unittest.mock import patch

import pytest

from backend.models import GISLayer, OTEFViewportState, Table
from backend.supabase_proxy import (
    _rows_to_geojson_feature_collection,
    pull_published_curated_layers_from_supabase,
)


def _line_row(submission_id, project_id, feature_type="pink_line_route"):
    return {
        "submission_id": submission_id,
        "project_id": project_id,
        "is_current": True,
        "feature_type": feature_type,
        "geom": {
            "type": "LineString",
            "coordinates": [[34.0, 32.0], [34.01, 32.01]],
        },
    }


@pytest.mark.django_db
def test_pull_autopublishes_new_submission_when_workshop_on():
    project_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    existing_sid = "11111111-1111-1111-1111-111111111111"
    new_sid = "22222222-2222-2222-2222-222222222222"

    table = Table.objects.create(
        name=f"ws_autopub_{uuid.uuid4().hex[:10]}",
        display_name="Workshop autopublish",
    )
    OTEFViewportState.objects.create(
        table=table,
        workshop_auto_publish=True,
        viewport=OTEFViewportState.DEFAULT_VIEWPORT.copy(),
        layers=OTEFViewportState.DEFAULT_LAYERS.copy(),
    )

    row_existing = _line_row(existing_sid, project_id)
    published_fc = _rows_to_geojson_feature_collection([row_existing])
    GISLayer.objects.create(
        table=table,
        name="curated_ws_existing",
        display_name="Existing pub",
        project_name="Moreshet Axis",
        layer_type="geojson",
        data=published_fc,
        style_config={},
        is_active=True,
        order=1,
    )

    row_new = _line_row(new_sid, project_id)

    def fake_get(path, params=None):
        params = params or {}
        if path == "/submission_batches":
            return [], None
        if path == "/geo_features":
            if params.get("project_id") == f"eq.{project_id}":
                return [row_existing, row_new], None
            sub = params.get("submission_id") or ""
            if sub == f"eq.{existing_sid}":
                return [row_existing], None
            if sub == f"eq.{new_sid}":
                return [row_new], None
        return None, f"unexpected supabase path {path} {params}"

    with patch("backend.supabase_proxy._get", side_effect=fake_get):
        with patch("backend.supabase_proxy._broadcast_otef_layers_changed") as mock_bc:
            out = pull_published_curated_layers_from_supabase(table, table.name)

    assert out.get("autopublished", 0) >= 1
    assert GISLayer.objects.filter(
        table=table, is_active=True, name__startswith="curated_"
    ).count() >= 2
    assert mock_bc.called


@pytest.mark.django_db
def test_pull_workshop_skips_when_no_project_id_on_published_layers():
    table = Table.objects.create(
        name=f"ws_nopid_{uuid.uuid4().hex[:10]}",
        display_name="No project id",
    )
    OTEFViewportState.objects.create(
        table=table,
        workshop_auto_publish=True,
        viewport=OTEFViewportState.DEFAULT_VIEWPORT.copy(),
        layers=OTEFViewportState.DEFAULT_LAYERS.copy(),
    )
    fc_no_project = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [34.0, 32.0]},
                "properties": {},
            }
        ],
    }
    GISLayer.objects.create(
        table=table,
        name="curated_no_project",
        display_name="Pub",
        project_name="Moreshet Axis",
        layer_type="geojson",
        data=fc_no_project,
        style_config={},
        is_active=True,
        order=1,
    )

    def fake_get(path, params=None):
        if path == "/submission_batches":
            return [], None
        if path == "/geo_features":
            return [], None
        return None, "unexpected"

    with patch("backend.supabase_proxy._get", side_effect=fake_get):
        out = pull_published_curated_layers_from_supabase(table, table.name)

    assert out["autopublished"] == 0
    errs = out.get("errors") or []
    assert any(
        isinstance(e, dict)
        and e.get("error") == "workshop_autopublish_skipped_no_published_curated_project_id"
        for e in errs
    )


@pytest.mark.django_db
def test_pull_autopublish_fallback_project_id_from_pink_geo_features():
    """Published curated GeoJSON has no project_id; pink geo_features rows agree on one project."""
    project_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    existing_sid = "11111111-1111-1111-1111-111111111111"
    new_sid = "22222222-2222-2222-2222-222222222222"

    table = Table.objects.create(
        name=f"ws_fb_pid_{uuid.uuid4().hex[:10]}",
        display_name="Workshop fallback project_id",
    )
    OTEFViewportState.objects.create(
        table=table,
        workshop_auto_publish=True,
        viewport=OTEFViewportState.DEFAULT_VIEWPORT.copy(),
        layers=OTEFViewportState.DEFAULT_LAYERS.copy(),
    )

    fc_no_project_id = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[34.0, 32.0], [34.01, 32.01]],
                },
                "properties": {"submission_id": existing_sid},
            }
        ],
    }
    GISLayer.objects.create(
        table=table,
        name="curated_ws_fallback_pub",
        display_name="Pub no project_id",
        project_name="Moreshet Axis",
        layer_type="geojson",
        data=fc_no_project_id,
        style_config={},
        is_active=True,
        order=1,
    )

    row_existing = _line_row(existing_sid, project_id)
    row_new = _line_row(new_sid, project_id)

    def fake_get(path, params=None):
        params = params or {}
        if path == "/submission_batches":
            return [], None
        if path == "/geo_features":
            if params.get("feature_type") == "like.pink_%":
                return [row_existing, row_new], None
            if params.get("project_id") == f"eq.{project_id}":
                return [row_existing, row_new], None
            sub = params.get("submission_id") or ""
            if sub == f"eq.{existing_sid}":
                return [row_existing], None
            if sub == f"eq.{new_sid}":
                return [row_new], None
        return None, f"unexpected supabase path {path} {params}"

    with patch("backend.supabase_proxy._get", side_effect=fake_get):
        with patch("backend.supabase_proxy._broadcast_otef_layers_changed") as mock_bc:
            out = pull_published_curated_layers_from_supabase(table, table.name)

    assert out.get("autopublished", 0) >= 1
    assert GISLayer.objects.filter(
        table=table, is_active=True, name__startswith="curated_"
    ).count() >= 2
    assert mock_bc.called


@pytest.mark.django_db
def test_pull_second_tick_autopublishes_new_pink_submission():
    """Second heartbeat pull must re-query geo_features list and see a new pink submission."""
    project_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    sid_a = "11111111-1111-1111-1111-111111111111"
    sid_b = "22222222-2222-2222-2222-222222222222"

    table = Table.objects.create(
        name=f"ws_twopull_{uuid.uuid4().hex[:10]}",
        display_name="Workshop two-pull",
    )
    OTEFViewportState.objects.create(
        table=table,
        workshop_auto_publish=True,
        viewport=OTEFViewportState.DEFAULT_VIEWPORT.copy(),
        layers=OTEFViewportState.DEFAULT_LAYERS.copy(),
    )

    row_a = _line_row(sid_a, project_id)
    published_fc = _rows_to_geojson_feature_collection([row_a])
    GISLayer.objects.create(
        table=table,
        name="curated_ws_pull_a",
        display_name="First pub",
        project_name="Moreshet Axis",
        layer_type="geojson",
        data=published_fc,
        style_config={},
        is_active=True,
        order=1,
    )

    row_b = _line_row(sid_b, project_id)
    pull_round = {"n": 0}

    def pull_once():
        pull_round["n"] += 1
        return pull_published_curated_layers_from_supabase(table, table.name)

    def fake_get(path, params=None):
        params = params or {}
        if path == "/submission_batches":
            return [], None
        if path == "/geo_features":
            if params.get("project_id") == f"eq.{project_id}":
                if pull_round["n"] <= 1:
                    return [row_a], None
                return [row_a, row_b], None
            sub = params.get("submission_id") or ""
            if sub == f"eq.{sid_a}":
                return [row_a], None
            if sub == f"eq.{sid_b}":
                return [row_b], None
        return None, f"unexpected supabase path {path} {params}"

    with patch("backend.supabase_proxy._get", side_effect=fake_get):
        with patch("backend.supabase_proxy._broadcast_otef_layers_changed"):
            out1 = pull_once()
            out2 = pull_once()

    assert out1.get("autopublished", 0) == 0
    assert out2.get("autopublished", 0) >= 1
    assert GISLayer.objects.filter(
        table=table, is_active=True, name__startswith="curated_"
    ).count() >= 2
