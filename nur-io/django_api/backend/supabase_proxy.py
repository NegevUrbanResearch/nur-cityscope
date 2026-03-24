"""
Supabase proxy: query Supabase from Django only (service role key).
All Supabase access goes through these endpoints; frontend never uses Supabase directly.
"""

import logging
import os
import re
from datetime import datetime, timezone
import requests
from django.conf import settings
from django.db import DatabaseError, IntegrityError, models
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

logger = logging.getLogger(__name__)


def _is_missing_table_error(err, table_hint=""):
    msg = str(err or "").lower()
    if not msg:
        return False
    missing_table_markers = (
        "no such table",
        "does not exist",
        "undefined table",
    )
    if not any(marker in msg for marker in missing_table_markers):
        return False
    hint = str(table_hint or "").strip().lower()
    if not hint:
        return True
    return hint in msg


def _slugify_project(name):
    """
    Slugify a human project name for curated group IDs.

    - Lowercase, trim
    - Replace whitespace with underscore
    - Strip non [a-z0-9_]
    - Fallback to 'default' when empty
    """
    if not isinstance(name, str):
        return "default"
    slug = name.strip().lower()
    slug = re.sub(r"\s+", "_", slug)
    slug = re.sub(r"[^a-z0-9_]", "", slug)
    return slug or "default"


def _supabase_headers():
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SECRET_KEY", "")
    if not url or not key:
        return None, None, "SUPABASE_URL and SUPABASE_SECRET_KEY must be set"
    return url, key, None


def _is_curation_write_authorized(request):
    """
    Gate write endpoints behind either:
    1) authenticated Django staff/superuser session, OR
    2) shared write token from header/env.
    """
    user = getattr(request, "user", None)
    if user and getattr(user, "is_authenticated", False):
        if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
            return True, None

    expected = os.environ.get("CURATION_WRITE_TOKEN", "").strip()
    if not expected:
        # Local/dev ergonomics: allow writes when DEBUG is enabled and no token is set.
        if getattr(settings, "DEBUG", False):
            return True, None
        return (
            False,
            "CURATION_WRITE_TOKEN is not configured. Writes are disabled until a token is set.",
        )

    header_token = (
        request.headers.get("X-Curation-Write-Token")
        or request.headers.get("x-curation-write-token")
        or ""
    ).strip()
    auth_header = (request.headers.get("Authorization") or "").strip()
    bearer = ""
    if auth_header.lower().startswith("bearer "):
        bearer = auth_header[7:].strip()

    provided = header_token or bearer
    if not provided or provided != expected:
        return False, "Unauthorized write request"

    return True, None


def _get(path, params=None):
    base, key, err = _supabase_headers()
    if err:
        return None, err
    url = f"{base}/rest/v1{path}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=representation",
    }
    try:
        r = requests.get(url, headers=headers, params=params or {}, timeout=30)
        r.raise_for_status()
        return r.json(), None
    except requests.RequestException as e:
        msg = str(e)
        if hasattr(e, "response") and e.response is not None:
            try:
                body = e.response.json()
                if isinstance(body, dict) and body.get("message"):
                    msg = f"{e.response.status_code}: {body.get('message')}"
                elif isinstance(body, dict) and body.get("error"):
                    msg = f"{e.response.status_code}: {body.get('error')}"
            except Exception:
                try:
                    msg = f"{msg} | body: {e.response.text[:200]}"
                except Exception:
                    pass
        if e.response is not None and e.response.status_code == 404:
            msg = f"{msg}. Ensure the table exists in Supabase (path: {path})."
        return None, msg


def _patch(path, payload, params=None):
    base, key, err = _supabase_headers()
    if err:
        return None, err
    url = f"{base}/rest/v1{path}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=representation",
    }
    try:
        r = requests.patch(url, headers=headers, params=params or {}, json=payload, timeout=30)
        r.raise_for_status()
        return r.json(), None
    except requests.RequestException as e:
        return None, str(e)


def _post(path, payload, params=None):
    base, key, err = _supabase_headers()
    if err:
        return None, err
    url = f"{base}/rest/v1{path}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=representation",
    }
    try:
        r = requests.post(url, headers=headers, params=params or {}, json=payload, timeout=30)
        r.raise_for_status()
        return r.json(), None
    except requests.RequestException as e:
        return None, str(e)


def _utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def _projects_path():
    table = os.environ.get("SUPABASE_PROJECTS_TABLE", "projects").strip() or "projects"
    return f"/{table}"


class SupabaseProjectsView(APIView):
    """GET /api/supabase/projects/ - list projects from Supabase table."""

    def get(self, request):
        try:
            path = _projects_path()
            data, err = _get(path)
            if err:
                logger.warning("Supabase projects error: %s", err)
                return Response({"error": err}, status=status.HTTP_502_BAD_GATEWAY)
            return Response(data if isinstance(data, list) else [])
        except Exception as e:
            logger.exception("Supabase projects unhandled error")
            return Response(
                {"error": f"Server error: {str(e)}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class SupabaseProjectSubmissionsView(APIView):
    """GET /api/supabase/projects/<id>/submissions/ - list submissions for a project (distinct submission_id from geo_features)."""

    def get(self, request, project_id):
        base, key, err = _supabase_headers()
        if err:
            return Response({"error": err}, status=status.HTTP_502_BAD_GATEWAY)
        url = f"{base}/rest/v1/geo_features"
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        include_history = str(
            request.query_params.get("include_history", "false")
        ).lower() in ("1", "true", "yes")

        def _fetch_rows(select_expr):
            params = {"project_id": f"eq.{project_id}", "select": select_expr}
            r = requests.get(url, headers=headers, params=params, timeout=30)
            r.raise_for_status()
            return r.json()

        try:
            rows = _fetch_rows("submission_id,is_current")
        except requests.RequestException as e:
            # Backward compatibility: older geo_features schemas may not yet
            # include is_current. Fall back to submission_id-only query so the
            # curation UI still lists submissions instead of hard-failing.
            msg = str(e or "")
            if "is_current" not in msg.lower():
                return Response({"error": msg}, status=status.HTTP_502_BAD_GATEWAY)
            try:
                rows = _fetch_rows("submission_id")
            except requests.RequestException as fallback_err:
                return Response(
                    {"error": str(fallback_err)},
                    status=status.HTTP_502_BAD_GATEWAY,
                )
        seen = set()
        submissions = []
        for row in rows:
            if not include_history and row.get("is_current") is False:
                continue
            sid = row.get("submission_id")
            if sid is not None and sid not in seen:
                seen.add(sid)
                submissions.append({"id": sid})
        return Response(submissions)


class SupabaseSubmissionFeaturesView(APIView):
    """GET /api/supabase/submissions/<id>/features/ - GeoJSON FeatureCollection for the submission."""

    def get(self, request, submission_id):
        base, key, err = _supabase_headers()
        if err:
            return Response({"error": err}, status=status.HTTP_502_BAD_GATEWAY)
        url = f"{base}/rest/v1/geo_features"
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        params = {"submission_id": f"eq.{submission_id}"}
        project_id = request.query_params.get("project_id")
        if project_id:
            params["project_id"] = f"eq.{project_id}"
        include_current = str(
            request.query_params.get("include_current", "true")
        ).lower() not in ("0", "false", "no")
        include_history = str(
            request.query_params.get("include_history", "false")
        ).lower() in ("1", "true", "yes")
        try:
            r = requests.get(url, headers=headers, params=params, timeout=30)
            r.raise_for_status()
            rows = r.json()
        except requests.RequestException as e:
            return Response({"error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)
        if not include_current and not include_history:
            return Response({"type": "FeatureCollection", "features": []})
        features = []
        for row in rows:
            is_current = row.get("is_current")
            if include_current and not include_history:
                if is_current is False:
                    continue
            elif include_history and not include_current:
                if is_current is not False:
                    continue
            geom = row.get("geom")
            if not geom:
                continue
            if isinstance(geom, dict) and geom.get("type") == "Feature":
                feat = geom
            elif isinstance(geom, dict) and geom.get("type") in ("Point", "LineString", "Polygon", "MultiPoint", "MultiLineString", "MultiPolygon"):
                feat = {"type": "Feature", "geometry": geom, "properties": {}}
            else:
                feat = {"type": "Feature", "geometry": geom, "properties": {}}
            props = feat.setdefault("properties", {})
            for key, value in row.items():
                if key == "geom":
                    continue
                props[key] = value
            features.append(feat)
        return Response({"type": "FeatureCollection", "features": features})


def _slugify_project(name):
    """Lowercase slug from project name for use in group IDs."""
    slug = name.lower().strip().replace(" ", "_")
    slug = re.sub(r"[^a-z0-9_]", "", slug)
    return slug or "default"


@method_decorator(csrf_exempt, name="dispatch")
class CuratedLayerPublishView(APIView):
    """
    POST /api/supabase/curated/publish/
    Body: { "name": str, "geojson": object, "table": str, "project_name": str }
    Creates GISLayer scoped to a project, ensures per-project LayerGroup,
    adds LayerState, returns layer id and group id.
    Rejects duplicate layer names within the same project.
    """

    def post(self, request):
        logger.info("Curated publish request received")
        import json
        from .models import Table, GISLayer, LayerGroup, LayerState

        authorized, auth_error = _is_curation_write_authorized(request)
        if not authorized:
            return Response(
                {"error": auth_error},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        name = (request.data.get("name") or "").strip()
        geojson = request.data.get("geojson")
        table_name = request.data.get("table") or "otef"
        project_name = (request.data.get("project_name") or "").strip()

        if not name:
            return Response(
                {"error": "name is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not project_name:
            return Response(
                {"error": "project_name is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not geojson or not isinstance(geojson, dict):
            return Response(
                {"error": "geojson object is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            geojson = json.loads(json.dumps(geojson))
        except (TypeError, ValueError) as e:
            return Response(
                {"error": f"Invalid geojson: {e}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            table = Table.objects.filter(name=table_name).first()
            if not table:
                return Response(
                    {"error": f"Table '{table_name}' not found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            # Enforce project-scoped uniqueness on display_name.
            if GISLayer.objects.filter(
                table=table, display_name=name, project_name=project_name
            ).exists():
                return Response(
                    {
                        "error": f'A layer named "{name}" already exists in project "{project_name}". Please choose another name.'
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            project_slug = _slugify_project(project_name)
            # Internal slug used for GISLayer.name; project scoped via unique_together.
            base_slug = re.sub(r"\s+", "_", name.lower()).strip("_")[:50]
            base = f"curated_{project_slug}_{base_slug}"[:100]
            layer_name = base or f"curated_{project_slug}"
            n = 0
            while GISLayer.objects.filter(
                table=table, name=layer_name, project_name=project_name
            ).exists():
                n += 1
                layer_name = f"{base}_{n}"

            order = (
                GISLayer.objects.filter(table=table).aggregate(
                    max_order=models.Max("order")
                ).get("max_order")
                or 0
            ) + 1

            layer = GISLayer.objects.create(
                table=table,
                name=layer_name,
                display_name=name,
                project_name=project_name,
                layer_type="geojson",
                data=geojson,
                style_config={},
                is_active=True,
                order=order,
            )

            group_id = "curated_moresht_axis"
            group, _ = LayerGroup.objects.get_or_create(
                table=table,
                group_id=group_id,
                defaults={"enabled": True},
            )
            group.enabled = True
            group.save()

            full_layer_id = f"{group_id}.{layer.id}"
            LayerState.objects.update_or_create(
                table=table,
                layer_id=full_layer_id,
                defaults={"enabled": True},
            )

            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync

            try:
                channel_layer = get_channel_layer()
                if channel_layer:
                    async_to_sync(channel_layer.group_send)(
                        "otef_channel",
                        {
                            "type": "broadcast_message",
                            "message": {
                                "type": "otef_layers_changed",
                                "table": table_name,
                            },
                        },
                    )
            except Exception:
                pass

            return Response(
                {
                    "layerId": layer.id,
                    "groupId": group_id,
                    "fullLayerId": full_layer_id,
                    "displayName": name,
                    "projectName": project_name,
                },
                status=status.HTTP_201_CREATED,
            )
        except Exception as e:
            logger.exception("Curated publish error")
            return Response(
                {"error": str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


@method_decorator(csrf_exempt, name="dispatch")
class CuratedLayerEditView(APIView):
    """
    POST /api/supabase/curated/edit/
    Body:
      {
        "table": "otef",
        "project_id": "<supabase project uuid>",
        "project_name": "Moresht Axis (ציר מורשת)",
        "submission_id": "<supabase submission uuid>",
        "feature_id": "<geo_features row id>",
        "before_geom": {...},
        "after_geom": {...},
        "published_layer_full_id": "curated_moresht_axis.123" (optional),
        "edited_by": "name" (optional),
        "reason": "optional note"
      }
    """

    def post(self, request):
        from .models import (
            Table,
            GISLayer,
            LayerState,
            CurationEditRevision,
        )

        authorized, auth_error = _is_curation_write_authorized(request)
        if not authorized:
            return Response(
                {"error": auth_error},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        table_name = (request.data.get("table") or "otef").strip() or "otef"
        project_id = (request.data.get("project_id") or "").strip()
        project_name = (request.data.get("project_name") or "").strip()
        submission_id = str(request.data.get("submission_id") or "").strip()
        feature_id = str(request.data.get("feature_id") or "").strip()
        before_geom = request.data.get("before_geom") or {}
        after_geom = request.data.get("after_geom") or {}
        edited_by = str(request.data.get("edited_by") or "").strip()
        reason = str(request.data.get("reason") or "").strip()
        published_full_layer_id = str(
            request.data.get("published_layer_full_id") or ""
        ).strip()

        if not feature_id:
            return Response(
                {"error": "feature_id is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(after_geom, dict):
            return Response(
                {"error": "after_geom must be a geometry object"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        table = Table.objects.filter(name=table_name).first()
        if not table:
            return Response(
                {"error": f"Table '{table_name}' not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        filters = {"id": f"eq.{feature_id}"}
        if project_id:
            filters["project_id"] = f"eq.{project_id}"
        if submission_id:
            filters["submission_id"] = f"eq.{submission_id}"

        rows, get_err = _get(
            "/geo_features",
            params={**filters, "select": "id,geom,project_id,submission_id"},
        )
        if get_err:
            return Response(
                {"error": f"Failed to load source feature: {get_err}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        if not rows:
            return Response(
                {"error": "Source feature was not found for the provided identifiers"},
                status=status.HTTP_404_NOT_FOUND,
            )
        if len(rows) != 1:
            return Response(
                {
                    "error": "Ambiguous source feature match. Provide project_id and submission_id to identify a single feature."
                },
                status=status.HTTP_409_CONFLICT,
            )
        source_row = rows[0]

        logger.info(
            "curated_edit: source feature resolved feature_id=%s submission_id=%s project_id=%s",
            feature_id,
            submission_id or str(source_row.get("submission_id") or ""),
            project_id,
        )

        persisted_before = source_row.get("geom")

        new_full_layer_id = None
        source_layer = None
        group_id = "curated_moresht_axis"
        if published_full_layer_id and "." in published_full_layer_id:
            parsed_group_id, layer_id_part = published_full_layer_id.split(".", 1)
            if parsed_group_id:
                group_id = parsed_group_id
            try:
                source_layer_id = int(layer_id_part)
            except (TypeError, ValueError):
                source_layer_id = None
            if source_layer_id is not None:
                source_layer = GISLayer.objects.filter(
                    table=table, id=source_layer_id, is_active=True
                ).first()

        if source_layer is None:
            for candidate in GISLayer.objects.filter(table=table, is_active=True).order_by("-updated_at"):
                data = candidate.data if isinstance(candidate.data, dict) else {}
                features = data.get("features") or []
                if any(
                    isinstance(feat, dict)
                    and isinstance(feat.get("properties"), dict)
                    and str(feat.get("properties", {}).get("id", "")) == feature_id
                    for feat in features
                ):
                    source_layer = candidate
                    break

        logger.info(
            "curated_edit: gis source_layer_id=%s published_layer_full_id=%s",
            source_layer.id if source_layer else None,
            published_full_layer_id or "",
        )

        candidate_next_geojson = None
        if source_layer:
            import json

            try:
                candidate_next_geojson = json.loads(json.dumps(source_layer.data or {}))
            except (TypeError, ValueError) as e:
                return Response(
                    {
                        "error": f"Published layer data could not be copied for revision: {e}"
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not isinstance(candidate_next_geojson, dict):
                candidate_next_geojson = {"type": "FeatureCollection", "features": []}
            features = candidate_next_geojson.get("features") or []
            mutated = False
            for feat in features:
                props = feat.get("properties") if isinstance(feat, dict) else None
                if not isinstance(props, dict):
                    continue
                if str(props.get("id", "")) == feature_id:
                    feat["geometry"] = after_geom
                    mutated = True
            if not mutated:
                return Response(
                    {
                        "error": "Published layer revision could not be materialized because matching feature id was not found in current GIS layer data."
                    },
                    status=status.HTTP_409_CONFLICT,
                )

        updated, patch_err = _patch(
            "/geo_features",
            payload={"geom": after_geom},
            params=filters,
        )
        if patch_err:
            return Response(
                {"error": f"Failed to save feature edit to Supabase: {patch_err}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        revision = None
        revision_warning = None
        try:
            revision = CurationEditRevision.objects.create(
                table=table,
                project_name=project_name,
                submission_id=submission_id or str(source_row.get("submission_id") or ""),
                feature_id=feature_id,
                edit_type="move_geometry",
                before_geom=persisted_before or {},
                after_geom=after_geom,
                edited_by=edited_by,
                reason=reason,
            )
            logger.info(
                "curated_edit: revision created id=%s feature_id=%s",
                revision.id,
                feature_id,
            )
        except (DatabaseError, IntegrityError, TypeError, ValueError) as e:
            # Local/dev safeguard: if migration for CurationEditRevision is missing,
            # keep edit flow working and return an explicit warning.
            if _is_missing_table_error(e, "curationeditrevision"):
                revision_warning = (
                    "Edit was saved, but revision history table is missing. "
                    "Run backend migrations to restore immutable edit audit trail."
                )
                logger.warning(
                    "curated_edit: revision table missing feature_id=%s submission_id=%s",
                    feature_id,
                    submission_id,
                )
            else:
                logger.exception(
                    "curated_edit: persistence failed feature_id=%s submission_id=%s "
                    "project_id=%s published_layer_full_id=%s",
                    feature_id,
                    submission_id,
                    project_id,
                    published_full_layer_id or "",
                )
                payload = {
                    "error": "Failed to persist curation edit (revision or layer). "
                    "See server logs for details."
                }
                if settings.DEBUG:
                    payload["detail"] = str(e)
                return Response(
                    payload,
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        try:
            if source_layer:
                # GISLayer enforces unique(table, name, project_name), so we must not
                # reuse source_layer.name while the source row still exists.
                next_suffix = 1
                new_layer = None
                while new_layer is None:
                    while GISLayer.objects.filter(
                        table=table,
                        name=f"{source_layer.name}_rev{next_suffix}"[:100],
                        project_name=source_layer.project_name,
                    ).exists():
                        next_suffix += 1

                    candidate_name = f"{source_layer.name}_rev{next_suffix}"[:100]
                    try:
                        new_layer = GISLayer.objects.create(
                            table=source_layer.table,
                            name=candidate_name,
                            display_name=source_layer.display_name,
                            project_name=source_layer.project_name,
                            layer_type=source_layer.layer_type,
                            data=candidate_next_geojson,
                            style_config=source_layer.style_config or {},
                            is_active=True,
                            order=source_layer.order,
                        )
                    except IntegrityError as create_err:
                        # Concurrent edits can pick the same candidate name.
                        if "d4737039_uniq" not in str(create_err):
                            raise
                        next_suffix += 1

                source_layer.is_active = False
                source_layer.save(update_fields=["is_active", "updated_at"])

                previous_full_layer_id = f"{group_id}.{source_layer.id}"
                LayerState.objects.filter(
                    table=table, layer_id=previous_full_layer_id
                ).update(enabled=False)
                new_full_layer_id = f"{group_id}.{new_layer.id}"
                LayerState.objects.update_or_create(
                    table=table,
                    layer_id=new_full_layer_id,
                    defaults={"enabled": True},
                )
                logger.info(
                    "curated_edit: new GIS revision layer id=%s full_id=%s",
                    new_layer.id,
                    new_full_layer_id,
                )

        except (DatabaseError, IntegrityError, TypeError, ValueError) as e:
            logger.exception(
                "curated_edit: persistence failed feature_id=%s submission_id=%s "
                "project_id=%s published_layer_full_id=%s",
                feature_id,
                submission_id,
                project_id,
                published_full_layer_id or "",
            )
            payload = {
                "error": "Failed to persist curation edit (revision or layer). "
                "See server logs for details."
            }
            if settings.DEBUG:
                payload["detail"] = str(e)
            return Response(
                payload,
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync

        try:
            channel_layer = get_channel_layer()
            if channel_layer:
                async_to_sync(channel_layer.group_send)(
                    "otef_channel",
                    {
                        "type": "broadcast_message",
                        "message": {"type": "otef_layers_changed", "table": table_name},
                    },
                )
        except Exception:
            pass

        return Response(
            {
                "ok": True,
                "revision_id": revision.id if revision else None,
                "feature_id": feature_id,
                "updated_rows": len(updated) if isinstance(updated, list) else None,
                "new_full_layer_id": new_full_layer_id,
                **({"warning": revision_warning} if revision_warning else {}),
            }
        )


@method_decorator(csrf_exempt, name="dispatch")
class CuratedLayerBatchEditView(APIView):
    """
    POST /api/supabase/curated/edit-batch/
    Body:
      {
        "table": "otef",
        "project_name": "Moreshet Axis",
        "submission_id": "<submission uuid>",
        "published_layer_full_id": "curated_moresht_axis.123" (optional),
        "edited_by": "name" (optional),
        "reason": "optional note",
        "edits": [
          {
            "feature_id": "<geo_features row id>",
            "project_id": "<project uuid>" (optional),
            "before_geom": {...},
            "after_geom": {...}
          }
        ]
      }
    Immutable flow:
    - append a new geo_features row per edit
    - mark previous row as non-current
    - create one GIS layer revision per request (if source layer known)
    """

    REQUIRED_IMMUTABLE_COLUMNS = ("feature_lineage_id", "revision", "is_current")
    OPTIONAL_IMMUTABLE_COLUMNS = (
        "supersedes_feature_id",
        "edited_at",
        "edited_by",
        "edit_reason",
    )

    def _schema_error_response(self, missing_columns):
        cols = ", ".join(sorted(set(missing_columns)))
        sql_hint = (
            "ALTER TABLE geo_features "
            "ADD COLUMN IF NOT EXISTS feature_lineage_id text, "
            "ADD COLUMN IF NOT EXISTS revision integer DEFAULT 1, "
            "ADD COLUMN IF NOT EXISTS is_current boolean DEFAULT true, "
            "ADD COLUMN IF NOT EXISTS supersedes_feature_id text, "
            "ADD COLUMN IF NOT EXISTS edited_at timestamptz, "
            "ADD COLUMN IF NOT EXISTS edited_by text, "
            "ADD COLUMN IF NOT EXISTS edit_reason text;"
        )
        return Response(
            {
                "error": (
                    "Immutable edit schema is missing in Supabase geo_features. "
                    f"Missing columns: {cols}"
                ),
                "migration_sql": sql_hint,
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    def _resolve_source_layer(self, table, published_full_layer_id, first_feature_id):
        from .models import GISLayer

        source_layer = None
        group_id = "curated_moresht_axis"
        if published_full_layer_id and "." in published_full_layer_id:
            parsed_group_id, layer_id_part = published_full_layer_id.split(".", 1)
            if parsed_group_id:
                group_id = parsed_group_id
            try:
                source_layer_id = int(layer_id_part)
            except (TypeError, ValueError):
                source_layer_id = None
            if source_layer_id is not None:
                source_layer = GISLayer.objects.filter(
                    table=table, id=source_layer_id, is_active=True
                ).first()

        if source_layer is None and first_feature_id:
            for candidate in GISLayer.objects.filter(table=table, is_active=True).order_by(
                "-updated_at"
            ):
                data = candidate.data if isinstance(candidate.data, dict) else {}
                features = data.get("features") or []
                if any(
                    isinstance(feat, dict)
                    and isinstance(feat.get("properties"), dict)
                    and str(feat.get("properties", {}).get("id", "")) == str(first_feature_id)
                    for feat in features
                ):
                    source_layer = candidate
                    break

        return source_layer, group_id

    def post(self, request):
        from .models import Table, GISLayer, LayerState, CurationEditRevision
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync

        authorized, auth_error = _is_curation_write_authorized(request)
        if not authorized:
            return Response(
                {"error": auth_error},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        table_name = (request.data.get("table") or "otef").strip() or "otef"
        project_name = (request.data.get("project_name") or "").strip()
        submission_id = str(request.data.get("submission_id") or "").strip()
        edited_by = str(request.data.get("edited_by") or "").strip()
        reason = str(request.data.get("reason") or "").strip()
        published_full_layer_id = str(
            request.data.get("published_layer_full_id") or ""
        ).strip()
        edits = request.data.get("edits")

        if not isinstance(edits, list) or not edits:
            return Response(
                {"error": "edits array is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        table = Table.objects.filter(name=table_name).first()
        if not table:
            return Response(
                {"error": f"Table '{table_name}' not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        first_feature_id = str((edits[0] or {}).get("feature_id") or "").strip()
        source_layer, group_id = self._resolve_source_layer(
            table, published_full_layer_id, first_feature_id
        )
        candidate_next_geojson = None
        if source_layer:
            import json

            candidate_next_geojson = json.loads(json.dumps(source_layer.data or {}))
            if not isinstance(candidate_next_geojson, dict):
                candidate_next_geojson = {"type": "FeatureCollection", "features": []}

        new_feature_ids = {}
        revision_ids = []
        warnings = []
        new_full_layer_id = None
        immutable_schema_checked = False
        pending_geo_mutations = {}

        for raw_edit in edits:
            edit = raw_edit or {}
            feature_id = str(edit.get("feature_id") or "").strip()
            if not feature_id:
                return Response(
                    {"error": "Each edit requires feature_id"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            after_geom = edit.get("after_geom")
            if not isinstance(after_geom, dict):
                return Response(
                    {"error": f"after_geom must be an object for feature_id={feature_id}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            project_id = str(edit.get("project_id") or "").strip()
            filters = {"id": f"eq.{feature_id}"}
            if project_id:
                filters["project_id"] = f"eq.{project_id}"
            if submission_id:
                filters["submission_id"] = f"eq.{submission_id}"

            rows, get_err = _get("/geo_features", params={**filters, "select": "*"})
            if get_err:
                return Response(
                    {"error": f"Failed to load source feature: {get_err}"},
                    status=status.HTTP_502_BAD_GATEWAY,
                )
            if not rows:
                return Response(
                    {
                        "error": (
                            f"Source feature was not found for feature_id={feature_id}. "
                            "Provide project_id/submission_id to disambiguate."
                        )
                    },
                    status=status.HTTP_404_NOT_FOUND,
                )
            if len(rows) != 1:
                return Response(
                    {
                        "error": (
                            f"Ambiguous source feature match for feature_id={feature_id}. "
                            "Provide project_id and submission_id to identify one row."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            source_row = rows[0]

            if not immutable_schema_checked:
                source_keys = set(source_row.keys())
                missing_required = [
                    c for c in self.REQUIRED_IMMUTABLE_COLUMNS if c not in source_keys
                ]
                if missing_required:
                    return self._schema_error_response(missing_required)
                immutable_schema_checked = True

            if source_row.get("is_current") is False:
                return Response(
                    {
                        "error": (
                            f"feature_id={feature_id} is not a current row. "
                            "Reload curation and retry with the latest version."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            lineage = str(source_row.get("feature_lineage_id") or source_row.get("id") or "")
            try:
                revision = int(source_row.get("revision") or 1)
            except (TypeError, ValueError):
                revision = 1

            new_row = dict(source_row)
            source_row_id = str(new_row.pop("id", ""))
            new_row["geom"] = after_geom
            new_row["is_current"] = True
            new_row["feature_lineage_id"] = lineage or source_row_id
            new_row["revision"] = revision + 1

            source_props = source_row if isinstance(source_row, dict) else {}
            if "supersedes_feature_id" in source_props:
                new_row["supersedes_feature_id"] = source_row_id
            if "edited_at" in source_props:
                new_row["edited_at"] = _utc_now_iso()
            if "edited_by" in source_props:
                new_row["edited_by"] = edited_by
            if "edit_reason" in source_props:
                new_row["edit_reason"] = reason

            inserted_rows, post_err = _post("/geo_features", payload=new_row)
            if post_err:
                missing_column_tokens = [
                    c
                    for c in (self.REQUIRED_IMMUTABLE_COLUMNS + self.OPTIONAL_IMMUTABLE_COLUMNS)
                    if c in str(post_err)
                ]
                if missing_column_tokens and "does not exist" in str(post_err):
                    return self._schema_error_response(missing_column_tokens)
                return Response(
                    {"error": f"Failed to insert immutable revision for {feature_id}: {post_err}"},
                    status=status.HTTP_502_BAD_GATEWAY,
                )

            inserted = (
                inserted_rows[0]
                if isinstance(inserted_rows, list) and inserted_rows
                else (inserted_rows if isinstance(inserted_rows, dict) else {})
            )
            new_feature_id = str(inserted.get("id") or "")
            if not new_feature_id:
                return Response(
                    {"error": f"Supabase insert did not return new row id for {feature_id}"},
                    status=status.HTTP_502_BAD_GATEWAY,
                )

            _, patch_err = _patch(
                "/geo_features",
                payload={"is_current": False},
                params={"id": f"eq.{source_row_id}"},
            )
            if patch_err:
                return Response(
                    {
                        "error": (
                            f"New immutable row was inserted for {feature_id}, but the previous "
                            f"row could not be marked non-current: {patch_err}"
                        )
                    },
                    status=status.HTTP_502_BAD_GATEWAY,
                )

            try:
                rev = CurationEditRevision.objects.create(
                    table=table,
                    project_name=project_name,
                    submission_id=submission_id or str(source_row.get("submission_id") or ""),
                    feature_id=feature_id,
                    edit_type="move_geometry",
                    before_geom=source_row.get("geom") or {},
                    after_geom=after_geom,
                    edited_by=edited_by,
                    reason=reason,
                )
                revision_ids.append(rev.id)
            except (DatabaseError, IntegrityError, TypeError, ValueError) as e:
                if _is_missing_table_error(e, "curationeditrevision"):
                    warnings.append(
                        "Immutable source row was saved, but Django revision table is missing."
                    )
                else:
                    return Response(
                        {
                            "error": (
                                "Failed to persist Django curation revision after immutable source save."
                            ),
                            **({"detail": str(e)} if settings.DEBUG else {}),
                        },
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    )

            new_feature_ids[feature_id] = new_feature_id
            pending_geo_mutations[feature_id] = after_geom

        if source_layer and candidate_next_geojson:
            features = candidate_next_geojson.get("features") or []
            mutated_ids = set()
            for feat in features:
                props = feat.get("properties") if isinstance(feat, dict) else None
                if not isinstance(props, dict):
                    continue
                feat_id = str(props.get("id", "")).strip()
                if feat_id and feat_id in pending_geo_mutations:
                    feat["geometry"] = pending_geo_mutations[feat_id]
                    mutated_ids.add(feat_id)

            missing_from_gis = set(pending_geo_mutations.keys()) - mutated_ids
            if missing_from_gis:
                return Response(
                    {
                        "error": (
                            "Published layer revision could not be materialized for feature ids: "
                            + ", ".join(sorted(missing_from_gis))
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            next_suffix = 1
            new_layer = None
            while new_layer is None:
                while GISLayer.objects.filter(
                    table=table,
                    name=f"{source_layer.name}_rev{next_suffix}"[:100],
                    project_name=source_layer.project_name,
                ).exists():
                    next_suffix += 1
                candidate_name = f"{source_layer.name}_rev{next_suffix}"[:100]
                try:
                    new_layer = GISLayer.objects.create(
                        table=source_layer.table,
                        name=candidate_name,
                        display_name=source_layer.display_name,
                        project_name=source_layer.project_name,
                        layer_type=source_layer.layer_type,
                        data=candidate_next_geojson,
                        style_config=source_layer.style_config or {},
                        is_active=True,
                        order=source_layer.order,
                    )
                except IntegrityError as create_err:
                    if "d4737039_uniq" not in str(create_err):
                        raise
                    next_suffix += 1

            source_layer.is_active = False
            source_layer.save(update_fields=["is_active", "updated_at"])

            previous_full_layer_id = f"{group_id}.{source_layer.id}"
            LayerState.objects.filter(table=table, layer_id=previous_full_layer_id).update(
                enabled=False
            )
            new_full_layer_id = f"{group_id}.{new_layer.id}"
            LayerState.objects.update_or_create(
                table=table,
                layer_id=new_full_layer_id,
                defaults={"enabled": True},
            )

        try:
            channel_layer = get_channel_layer()
            if channel_layer:
                async_to_sync(channel_layer.group_send)(
                    "otef_channel",
                    {
                        "type": "broadcast_message",
                        "message": {"type": "otef_layers_changed", "table": table_name},
                    },
                )
        except Exception:
            pass

        response_payload = {
            "ok": True,
            "edits_applied": len(edits),
            "new_feature_ids": new_feature_ids,
            "new_full_layer_id": new_full_layer_id,
            "revision_ids": revision_ids,
        }
        if warnings:
            response_payload["warning"] = warnings[0]
        return Response(response_payload, status=status.HTTP_200_OK)


@method_decorator(csrf_exempt, name="dispatch")
class CuratedLayerUnpublishView(APIView):
    """
    POST /api/supabase/curated/unpublish/
    Body:
      {
        "table": "otef",
        "full_layer_id": "curated_moresht_axis.123"   (preferred)
        OR "layer_id": "123"
      }
    Soft-removes a published curated GISLayer by marking it inactive and deleting
    matching LayerState rows so it no longer appears in remote/projection layer
    controls or curated layer listings.
    """

    def post(self, request):
        from .models import Table, GISLayer, LayerState

        authorized, auth_error = _is_curation_write_authorized(request)
        if not authorized:
            return Response(
                {"error": auth_error},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        table_name = (request.data.get("table") or "otef").strip() or "otef"
        full_layer_id = str(request.data.get("full_layer_id") or "").strip()
        raw_layer_id = str(request.data.get("layer_id") or "").strip()

        if not raw_layer_id and full_layer_id:
            if "." in full_layer_id:
                _, raw_layer_id = full_layer_id.split(".", 1)
            else:
                raw_layer_id = full_layer_id

        try:
            layer_id = int(raw_layer_id)
        except (TypeError, ValueError):
            return Response(
                {"error": "layer_id (or full_layer_id with numeric suffix) is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        table = Table.objects.filter(name=table_name).first()
        if not table:
            return Response(
                {"error": f"Table '{table_name}' not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        layer = GISLayer.objects.filter(table=table, id=layer_id).first()
        if not layer:
            return Response(
                {"error": f"Layer '{layer_id}' not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        is_curated_name = str(getattr(layer, "name", "") or "").startswith("curated_")
        is_curated_state = LayerState.objects.filter(
            table=table,
            layer_id__endswith=f".{layer_id}",
            layer_id__startswith="curated",
        ).exists()
        if not (is_curated_name or is_curated_state):
            return Response(
                {"error": "Only curated published layers can be removed from this endpoint"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        layer.is_active = False
        layer.save(update_fields=["is_active", "updated_at"])

        # Remove LayerState rows that reference this numeric GIS layer id so group
        # listings cannot resurrect unpublished layers from stale state.
        LayerState.objects.filter(
            table=table, layer_id__endswith=f".{layer_id}"
        ).delete()

        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync

        try:
            channel_layer = get_channel_layer()
            if channel_layer:
                async_to_sync(channel_layer.group_send)(
                    "otef_channel",
                    {
                        "type": "broadcast_message",
                        "message": {"type": "otef_layers_changed", "table": table_name},
                    },
                )
        except Exception:
            pass

        return Response(
            {
                "ok": True,
                "layer_id": layer_id,
                "is_active": False,
            }
        )
