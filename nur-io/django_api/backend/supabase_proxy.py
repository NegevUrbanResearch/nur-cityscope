"""
Supabase proxy: query Supabase from Django only (service role key).
All Supabase access goes through these endpoints; frontend never uses Supabase directly.
"""

import logging
import os
import re
import requests
from django.db import models
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

logger = logging.getLogger(__name__)


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
        params = {"project_id": f"eq.{project_id}", "select": "submission_id"}
        try:
            r = requests.get(url, headers=headers, params=params, timeout=30)
            r.raise_for_status()
            rows = r.json()
        except requests.RequestException as e:
            return Response({"error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)
        seen = set()
        submissions = []
        for row in rows:
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
        try:
            r = requests.get(url, headers=headers, params=params, timeout=30)
            r.raise_for_status()
            rows = r.json()
        except requests.RequestException as e:
            return Response({"error": str(e)}, status=status.HTTP_502_BAD_GATEWAY)
        features = []
        for row in rows:
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

            group_id = f"curated_{project_slug}"
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
