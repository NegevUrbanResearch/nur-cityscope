import json

from django.http import JsonResponse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from .staff_remote_updates import StaffRemoteUpdateError, read_management_state, register_tablet, send_update_notice


@method_decorator(csrf_exempt, name="dispatch")
class StaffRemoteUpdatesView(View):
    def _respond(self, operation):
        try:
            return JsonResponse(operation(), headers={"Cache-Control": "no-store"})
        except StaffRemoteUpdateError as error:
            return JsonResponse(error.body, status=error.status, headers={"Cache-Control": "no-store"})

    def get(self, request):
        if set(request.GET) - {"table", "deviceId"}:
            return JsonResponse({"error": "invalid", "fields": {"query": "unknown field"}}, status=400)
        return self._respond(lambda: read_management_state(request.GET.get("table"), request.GET.get("deviceId")))

    def post(self, request):
        try:
            body = json.loads(request.body)
        except (ValueError, TypeError):
            body = None
        if not isinstance(body, dict):
            return JsonResponse({"error": "invalid", "fields": {"body": "must be JSON object"}}, status=400)
        action = body.get("action")
        fields = {"table", "action", "deviceId", "expectedRevision"}
        fields |= {"replaceDeviceId"} if action == "register" else {"targetBuildId"}
        if action not in ("register", "send_notice") or set(body) != fields:
            return JsonResponse({"error": "invalid", "fields": {"body": "invalid action or fields"}}, status=400)
        if action == "register":
            return self._respond(lambda: register_tablet(body["table"], body["deviceId"], body["expectedRevision"], body["replaceDeviceId"]))
        return self._respond(lambda: send_update_notice(body["table"], body["deviceId"], body["expectedRevision"], body["targetBuildId"]))
