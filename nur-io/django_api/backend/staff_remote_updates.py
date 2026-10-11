"""One active exhibit browser registration and its latest manually sent notice."""
import re
import logging
from uuid import UUID

from django.db import transaction
from django.utils import timezone

from .models import OTEFStaffRemoteUpdates, Table

MAX_REVISION = 2**53 - 1
BUILD_ID = re.compile(r"^frontend-[a-f0-9]{16}$")


def publish_management_change(revision):
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer
    from websocket_app.staff_remote_management import _group
    event = {"type": "staff_remote_management_event", "message": {
        "type": "otef_staff_remote_notice_changed_v1", "table": "otef", "revision": revision}}
    try:
        layer = get_channel_layer()
        for group in (_group("producers"), _group("observers_all")):
            async_to_sync(layer.group_send)(group, event)
    except Exception:
        logging.getLogger(__name__).warning("Tablet notice saved; connection signal unavailable", exc_info=True)


def _changed(row):
    revision = row.revision
    transaction.on_commit(lambda: publish_management_change(revision))


class StaffRemoteUpdateError(Exception):
    def __init__(self, error, status=400, **details):
        self.body = {"error": error, **details}
        self.status = status
        super().__init__(error)


def validate_device_id(value):
    try:
        if not isinstance(value, str) or str(UUID(value)) != value:
            raise ValueError()
    except (ValueError, AttributeError):
        raise StaffRemoteUpdateError("invalid", fields={"deviceId": "must be a canonical UUID"})
    return value


def _revision(value):
    if type(value) is not int or not 0 <= value <= MAX_REVISION:
        raise StaffRemoteUpdateError("invalid", fields={"expectedRevision": "must be a nonnegative safe integer"})


def _table(name, lock=False):
    if name != "otef":
        raise StaffRemoteUpdateError("not_found", 404)
    query = Table.objects.select_for_update() if lock else Table.objects
    try:
        return query.get(name=name)
    except Table.DoesNotExist:
        raise StaffRemoteUpdateError("not_found", 404)


def _state(row):
    return {"table": "otef", "revision": row.revision if row else 0,
            "deviceId": str(row.device_id) if row and row.device_id else None,
            "notice": {"revision": row.revision, "targetBuildId": row.notice_build_id,
                       "createdAt": row.notice_created_at.isoformat()} if row and row.notice_build_id else None}


def read_management_state(table_name, device_id=None):
    if device_id is not None:
        validate_device_id(device_id)
    row = OTEFStaffRemoteUpdates.objects.filter(table=_table(table_name)).first()
    state = _state(row)
    if device_id is not None and state["deviceId"] != device_id:
        raise StaffRemoteUpdateError("unregistered", 409, state=state)
    return state


def _conflict(row):
    raise StaffRemoteUpdateError("conflict", 409, state=_state(row))


def _advance(row):
    if row.revision >= MAX_REVISION:
        raise StaffRemoteUpdateError("invalid", fields={"revision": "revision limit reached"})
    row.revision += 1


@transaction.atomic
def register_tablet(table_name, device_id, expected_revision, replace_device_id=None):
    validate_device_id(device_id)
    _revision(expected_revision)
    if replace_device_id is not None:
        validate_device_id(replace_device_id)
    row, _ = OTEFStaffRemoteUpdates.objects.get_or_create(table=_table(table_name, lock=True))
    current = str(row.device_id) if row.device_id else None
    if current == device_id:
        return _state(row)
    if row.revision != expected_revision or current != replace_device_id:
        _conflict(row)
    row.device_id = device_id
    row.notice_build_id = None
    row.notice_created_at = None
    _advance(row)
    row.save()
    _changed(row)
    return _state(row)


@transaction.atomic
def send_update_notice(table_name, device_id, expected_revision, target_build_id):
    validate_device_id(device_id)
    _revision(expected_revision)
    if not isinstance(target_build_id, str) or not BUILD_ID.fullmatch(target_build_id):
        raise StaffRemoteUpdateError("invalid", fields={"targetBuildId": "must be a frontend build ID"})
    row, _ = OTEFStaffRemoteUpdates.objects.get_or_create(table=_table(table_name, lock=True))
    if str(row.device_id) != device_id:
        raise StaffRemoteUpdateError("unregistered", 409, state=_state(row))
    if row.notice_build_id == target_build_id:
        return _state(row)
    if row.revision != expected_revision:
        _conflict(row)
    row.notice_build_id = target_build_id
    row.notice_created_at = timezone.now()
    _advance(row)
    row.save()
    _changed(row)
    return _state(row)
