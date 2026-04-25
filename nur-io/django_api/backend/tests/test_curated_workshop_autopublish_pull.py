import json
import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from backend.models import (
    GISLayer,
    OTEFViewportState,
    Table,
    WorkshopAutopublishSuppression,
)
from backend.supabase_proxy import (
    _find_active_curated_layer_for_submission,
    _norm_submission_id_key,
    _rows_to_geojson_feature_collection,
    pull_published_curated_layers_from_supabase,
)


def _assert_pull_response_task5_contract(out, expect_autopublished_ids_in_affected=False):
    assert "updated_layer_ids" in out
    assert "autopublished_layer_ids" in out
    assert "affected_curated_full_layer_ids" in out
    assert isinstance(out["updated_layer_ids"], list)
    assert isinstance(out["autopublished_layer_ids"], list)
    assert isinstance(out["affected_curated_full_layer_ids"], list)
    if expect_autopublished_ids_in_affected:
        affected = set(out["affected_curated_full_layer_ids"])
        for pk in out["autopublished_layer_ids"]:
            assert f"curated_moresht_axis.{pk}" in affected


def _line_row(submission_id, project_id, feature_type="pink_line_route"):
    return {
        "id": f"gf-{submission_id}",
        "submission_id": submission_id,
        "project_id": project_id,
        "is_current": True,
        "feature_type": feature_type,
        "updated_at": "2099-01-01T00:00:00+00:00",
        "geom": {
            "type": "LineString",
            "coordinates": [[34.0, 32.0], [34.01, 32.01]],
        },
    }


def _geo_features_response_rows(full_rows, params):
    """Mirror PostgREST select= projection for geo_features mocks."""
    params = params or {}
    sel = (params.get("select") or "*").strip()
    if sel == "*":
        return list(full_rows)
    keys = [k.strip() for k in sel.split(",") if k.strip()]
    out = []
    for r in full_rows:
        out.append({k: r.get(k) for k in keys})
    return out


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
                return _geo_features_response_rows(
                    [row_existing, row_new], params
                ), None
            sub = params.get("submission_id") or ""
            if sub == f"eq.{existing_sid}":
                return _geo_features_response_rows([row_existing], params), None
            if sub == f"eq.{new_sid}":
                return _geo_features_response_rows([row_new], params), None
        return None, f"unexpected supabase path {path} {params}"

    with patch("backend.supabase_proxy._get", side_effect=fake_get):
        with patch("backend.supabase_proxy._broadcast_otef_layers_changed") as mock_bc:
            out = pull_published_curated_layers_from_supabase(table, table.name)

    _assert_pull_response_task5_contract(out, expect_autopublished_ids_in_affected=True)
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
            return _geo_features_response_rows([], params), None
        return None, "unexpected"

    with patch("backend.supabase_proxy._get", side_effect=fake_get):
        out = pull_published_curated_layers_from_supabase(table, table.name)

    _assert_pull_response_task5_contract(out, expect_autopublished_ids_in_affected=False)
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
                return _geo_features_response_rows(
                    [row_existing, row_new], params
                ), None
            if params.get("project_id") == f"eq.{project_id}":
                return _geo_features_response_rows(
                    [row_existing, row_new], params
                ), None
            sub = params.get("submission_id") or ""
            if sub == f"eq.{existing_sid}":
                return _geo_features_response_rows([row_existing], params), None
            if sub == f"eq.{new_sid}":
                return _geo_features_response_rows([row_new], params), None
        return None, f"unexpected supabase path {path} {params}"

    with patch("backend.supabase_proxy._get", side_effect=fake_get):
        with patch("backend.supabase_proxy._broadcast_otef_layers_changed") as mock_bc:
            out = pull_published_curated_layers_from_supabase(table, table.name)

    _assert_pull_response_task5_contract(out, expect_autopublished_ids_in_affected=True)
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
                    return _geo_features_response_rows([row_a], params), None
                return _geo_features_response_rows([row_a, row_b], params), None
            sub = params.get("submission_id") or ""
            if sub == f"eq.{sid_a}":
                return _geo_features_response_rows([row_a], params), None
            if sub == f"eq.{sid_b}":
                return _geo_features_response_rows([row_b], params), None
        return None, f"unexpected supabase path {path} {params}"

    with patch("backend.supabase_proxy._get", side_effect=fake_get):
        with patch("backend.supabase_proxy._broadcast_otef_layers_changed"):
            out1 = pull_once()
            out2 = pull_once()

    _assert_pull_response_task5_contract(out1, expect_autopublished_ids_in_affected=False)
    _assert_pull_response_task5_contract(out2, expect_autopublished_ids_in_affected=True)
    assert out1.get("autopublished", 0) == 0
    assert out2.get("autopublished", 0) >= 1
    assert GISLayer.objects.filter(
        table=table, is_active=True, name__startswith="curated_"
    ).count() >= 2


@pytest.mark.django_db
def test_pull_skips_autopublish_for_pink_submission_before_workshop_start():
    """
    submission_batches clock before workshop_autopublish_started_at is ineligible;
    a later submission after the window is autopublished with submission_name (not UUID fallback).
    """
    project_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    old_sid = "11111111-1111-1111-1111-111111111111"
    sid_before = "22222222-2222-2222-2222-222222222222"
    sid_after = "33333333-3333-3333-3333-333333333333"
    workshop_start = timezone.now() - timedelta(days=1)
    ts_before = (workshop_start - timedelta(hours=2)).isoformat()
    ts_after = (workshop_start + timedelta(hours=2)).isoformat()

    table = Table.objects.create(
        name=f"ws_win_{uuid.uuid4().hex[:10]}",
        display_name="Workshop window",
    )
    state = OTEFViewportState.objects.create(
        table=table,
        workshop_auto_publish=False,
        viewport=OTEFViewportState.DEFAULT_VIEWPORT.copy(),
        layers=OTEFViewportState.DEFAULT_LAYERS.copy(),
    )
    OTEFViewportState.objects.filter(pk=state.pk).update(
        workshop_autopublish_started_at=workshop_start,
        workshop_auto_publish=True,
    )

    row_old = _line_row(old_sid, project_id)
    row_before = _line_row(sid_before, project_id)
    row_after = _line_row(sid_after, project_id)
    published_fc = _rows_to_geojson_feature_collection([row_old])
    GISLayer.objects.create(
        table=table,
        name="curated_ws_window_existing",
        display_name="Existing pub",
        project_name="Moreshet Axis",
        layer_type="geojson",
        data=published_fc,
        style_config={},
        is_active=True,
        order=1,
    )

    def fake_get(path, params=None):
        params = params or {}
        if path == "/submission_batches":
            sub = params.get("submission_id") or ""
            if sub == f"eq.{old_sid}":
                return [
                    {
                        "submission_id": old_sid,
                        "submission_name": "Old Sid Batch",
                        "created_at": ts_before,
                        "updated_at": ts_before,
                    }
                ], None
            if sub == f"eq.{sid_before}":
                return [
                    {
                        "submission_id": sid_before,
                        "submission_name": "Should Not Publish",
                        "created_at": ts_before,
                        "updated_at": ts_before,
                    }
                ], None
            if sub == f"eq.{sid_after}":
                return [
                    {
                        "submission_id": sid_after,
                        "submission_name": "Late Workshop Route Title",
                        "created_at": ts_after,
                        "updated_at": ts_after,
                    }
                ], None
            return [], None
        if path == "/geo_features":
            if params.get("project_id") == f"eq.{project_id}":
                return _geo_features_response_rows(
                    [row_old, row_before, row_after], params
                ), None
            sub = params.get("submission_id") or ""
            if sub == f"eq.{old_sid}":
                return _geo_features_response_rows([row_old], params), None
            if sub == f"eq.{sid_before}":
                return _geo_features_response_rows([row_before], params), None
            if sub == f"eq.{sid_after}":
                return _geo_features_response_rows([row_after], params), None
        return None, f"unexpected supabase path {path} {params}"

    with patch("backend.supabase_proxy._get", side_effect=fake_get):
        with patch("backend.supabase_proxy._broadcast_otef_layers_changed") as mock_bc:
            out = pull_published_curated_layers_from_supabase(table, table.name)

    _assert_pull_response_task5_contract(out, expect_autopublished_ids_in_affected=True)
    assert out["autopublished"] == 1
    assert out["autopublished_layer_ids"] and len(out["autopublished_layer_ids"]) == 1
    late_layer = GISLayer.objects.get(pk=out["autopublished_layer_ids"][0])
    assert late_layer.display_name == "Late Workshop Route Title"
    assert sid_after not in late_layer.display_name
    assert _find_active_curated_layer_for_submission(table, sid_before) is None
    assert mock_bc.called


@pytest.mark.django_db
def test_pull_does_not_autopublish_after_suppression_recorded():
    project_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    existing_sid = "11111111-1111-1111-1111-111111111111"
    new_sid = "22222222-2222-2222-2222-222222222222"

    table = Table.objects.create(
        name=f"ws_suppr_{uuid.uuid4().hex[:10]}",
        display_name="Workshop suppression",
    )
    state = OTEFViewportState.objects.create(
        table=table,
        workshop_auto_publish=False,
        viewport=OTEFViewportState.DEFAULT_VIEWPORT.copy(),
        layers=OTEFViewportState.DEFAULT_LAYERS.copy(),
    )
    OTEFViewportState.objects.filter(pk=state.pk).update(
        workshop_autopublish_started_at=timezone.now() - timedelta(days=7),
        workshop_auto_publish=True,
    )

    row_existing = _line_row(existing_sid, project_id)
    published_fc = _rows_to_geojson_feature_collection([row_existing])
    GISLayer.objects.create(
        table=table,
        name="curated_ws_suppr_existing",
        display_name="Existing pub",
        project_name="Moreshet Axis",
        layer_type="geojson",
        data=published_fc,
        style_config={},
        is_active=True,
        order=1,
    )

    WorkshopAutopublishSuppression.objects.create(
        table=table,
        submission_id=_norm_submission_id_key(new_sid),
    )

    row_new = _line_row(new_sid, project_id)
    ts_after = (timezone.now() - timedelta(hours=1)).isoformat()

    def fake_get(path, params=None):
        params = params or {}
        if path == "/submission_batches":
            sub = params.get("submission_id") or ""
            if sub == f"eq.{existing_sid}":
                return [
                    {
                        "submission_id": existing_sid,
                        "submission_name": "Existing",
                        "created_at": ts_after,
                        "updated_at": ts_after,
                    }
                ], None
            if sub == f"eq.{new_sid}":
                return [
                    {
                        "submission_id": new_sid,
                        "submission_name": "Suppressed Name",
                        "created_at": ts_after,
                        "updated_at": ts_after,
                    }
                ], None
            return [], None
        if path == "/geo_features":
            if params.get("project_id") == f"eq.{project_id}":
                return _geo_features_response_rows(
                    [row_existing, row_new], params
                ), None
            sub = params.get("submission_id") or ""
            if sub == f"eq.{existing_sid}":
                return _geo_features_response_rows([row_existing], params), None
            if sub == f"eq.{new_sid}":
                return _geo_features_response_rows([row_new], params), None
        return None, f"unexpected supabase path {path} {params}"

    with patch("backend.supabase_proxy._get", side_effect=fake_get):
        out = pull_published_curated_layers_from_supabase(table, table.name)

    _assert_pull_response_task5_contract(out, expect_autopublished_ids_in_affected=False)
    assert out["autopublished"] == 0
    assert out["autopublished_layer_ids"] == []
    assert _find_active_curated_layer_for_submission(table, new_sid) is None


@pytest.mark.django_db
def test_pull_skips_full_geo_fetch_when_fingerprints_unchanged():
    """Lightweight select matches stored layer + batch — no select=* on geo_features."""
    project_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    sid = "11111111-1111-1111-1111-111111111111"
    table = Table.objects.create(
        name=f"ws_skipfull_{uuid.uuid4().hex[:10]}",
        display_name="Skip full geo",
    )
    OTEFViewportState.objects.create(
        table=table,
        workshop_auto_publish=False,
        viewport=OTEFViewportState.DEFAULT_VIEWPORT.copy(),
        layers=OTEFViewportState.DEFAULT_LAYERS.copy(),
    )
    row = _line_row(sid, project_id)
    published_fc = _rows_to_geojson_feature_collection([row])
    GISLayer.objects.create(
        table=table,
        name="curated_skip_full",
        display_name="Pub",
        project_name="Moreshet Axis",
        layer_type="geojson",
        data=published_fc,
        style_config={},
        is_active=True,
        order=1,
    )

    def fake_get(path, params=None):
        params = params or {}
        if path == "/submission_batches":
            return [], None
        if path == "/geo_features":
            sub = params.get("submission_id") or ""
            if sub == f"eq.{sid}":
                return _geo_features_response_rows([row], params), None
        return None, f"unexpected supabase path {path} {params}"

    with patch("backend.supabase_proxy._get", side_effect=fake_get):
        with patch(
            "backend.supabase_proxy._fetch_submission_geojson_fc"
        ) as mock_full:
            out = pull_published_curated_layers_from_supabase(table, table.name)

    assert out["updated"] == 0
    mock_full.assert_not_called()


@pytest.mark.django_db
def test_pull_runs_full_geo_when_lightweight_timestamp_changes():
    project_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    sid = "11111111-1111-1111-1111-111111111111"
    table = Table.objects.create(
        name=f"ws_fullgeo_{uuid.uuid4().hex[:10]}",
        display_name="Full geo on change",
    )
    OTEFViewportState.objects.create(
        table=table,
        workshop_auto_publish=False,
        viewport=OTEFViewportState.DEFAULT_VIEWPORT.copy(),
        layers=OTEFViewportState.DEFAULT_LAYERS.copy(),
    )
    row_stale = _line_row(sid, project_id)
    published_fc = _rows_to_geojson_feature_collection([row_stale])
    GISLayer.objects.create(
        table=table,
        name="curated_full_geo",
        display_name="Pub",
        project_name="Moreshet Axis",
        layer_type="geojson",
        data=published_fc,
        style_config={},
        is_active=True,
        order=1,
    )
    row_remote = dict(row_stale)
    row_remote["updated_at"] = "2099-06-15T12:00:00+00:00"

    def fake_get(path, params=None):
        params = params or {}
        if path == "/submission_batches":
            return [], None
        if path == "/geo_features":
            sub = params.get("submission_id") or ""
            if sub == f"eq.{sid}":
                return _geo_features_response_rows([row_remote], params), None
        return None, f"unexpected supabase path {path} {params}"

    with patch("backend.supabase_proxy._get", side_effect=fake_get):
        with patch("backend.supabase_proxy._broadcast_otef_layers_changed") as mock_bc:
            out = pull_published_curated_layers_from_supabase(table, table.name)

    assert out["updated"] == 1
    mock_bc.assert_called()
    layer = GISLayer.objects.get(pk=out["updated_layer_ids"][0])
    assert "2099-06-15" in json.dumps(layer.data)
