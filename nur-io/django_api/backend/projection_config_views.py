import json

from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from .projection_config_service import (
    ProjectionConfigError,
    ProjectionConflict,
    get_projection_state,
    mutate_projection_state,
)


@method_decorator(csrf_exempt, name="dispatch")
class ProjectionConfigView(View):
    def get(self, request):
        table = request.GET.get("table")
        if not table:
            return JsonResponse({"error": "invalid", "fields": {"table": "is required"}}, status=400)
        try:
            return JsonResponse(get_projection_state(table))
        except ProjectionConfigError as exc:
            return JsonResponse({"error": exc.error, "fields": exc.fields}, status=404)

    def post(self, request):
        try:
            body = json.loads(request.body)
        except (TypeError, ValueError):
            return JsonResponse({"error": "invalid", "fields": {"body": "must be JSON"}}, status=400)
        if not isinstance(body, dict):
            return JsonResponse({"error": "invalid", "fields": {"body": "must be an object"}}, status=400)
        allowed_fields = {"table", "baseRevision", "action", "sourceId", "config", "presetId", "name"}
        unknown_fields = {key: "unknown field" for key in body if key not in allowed_fields}
        if unknown_fields:
            return JsonResponse({"error": "invalid", "fields": unknown_fields}, status=400)
        try:
            state = mutate_projection_state(
                body.get("table"),
                body.get("baseRevision"),
                body.get("action"),
                body.get("sourceId"),
                **{key: value for key, value in body.items() if key not in {"table", "baseRevision", "action", "sourceId"}},
            )
            return JsonResponse(state)
        except ProjectionConflict as exc:
            return JsonResponse({"error": "conflict", "state": exc.state}, status=409)
        except ProjectionConfigError as exc:
            status = 404 if exc.error == "not_found" else 400
            return JsonResponse({"error": exc.error, "fields": exc.fields}, status=status)
