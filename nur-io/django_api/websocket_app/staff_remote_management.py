"""Ephemeral, room-scoped transport for NLI staff tablet management."""
import asyncio
import hashlib
import json
import re
import uuid

HEARTBEAT_MS = 10_000
LEASE_MS = 10_000
MAX_MESSAGE_BYTES = 1_024
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_REASONS = {"not_ready", "not_home", "busy", "owned_session"}
_REJECTIONS = _REASONS | {"expired", "storage_unavailable", "state_unavailable"}
_SCHEMAS = {
    "otef_staff_remote_subscribe": {"sourceId"},
    "otef_staff_remote_status_query": {"sourceId"},
    "otef_staff_remote_status": {"remoteId", "instanceId", "connectionSeq", "leaseSeq", "buildId", "visibility", "ready", "refreshBlockReason", "reloadReceipt"},
    "otef_staff_remote_refresh": {"sourceId", "requestId", "remoteId", "instanceId", "connectionSeq", "leaseSeq"},
    "otef_staff_remote_refresh_ack": {"sourceId", "requestId", "remoteId", "instanceId", "connectionSeq", "result", "reason"},
    "otef_staff_remote_disconnected": {"remoteId", "instanceId", "connectionSeq"},
}


def _valid_uuid(value):
    return isinstance(value, str) and bool(_UUID.fullmatch(value)) and str(uuid.UUID(value)) == value


def _positive_counter(value):
    return type(value) is int and 0 < value <= 9_007_199_254_740_991


def _valid_receipt(value):
    return value is None or (isinstance(value, dict) and set(value) == {"sourceId", "requestId", "previousInstanceId"} and
                             all(_valid_uuid(value[k]) for k in value))


def validate_staff_remote_message(value):
    if not isinstance(value, dict) or value.get("table") != "otef":
        return None
    kind = value.get("type")
    fields = _SCHEMAS.get(kind)
    if fields is None or set(value) != fields | {"type", "table"}:
        return None
    try:
        if len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) >= MAX_MESSAGE_BYTES:
            return None
    except (TypeError, ValueError, UnicodeEncodeError):
        return None
    ids = fields & {"sourceId", "requestId", "remoteId", "instanceId"}
    if not all(_valid_uuid(value[key]) for key in ids):
        return None
    if any(not _positive_counter(value[key]) for key in fields & {"connectionSeq", "leaseSeq"}):
        return None
    if kind == "otef_staff_remote_status":
        build = value["buildId"]
        if not (build is None or (isinstance(build, str) and len(build) <= 64 and all(0x20 <= ord(c) <= 0x7e for c in build))):
            return None
        if not isinstance(value["visibility"], str) or value["visibility"] not in {"visible", "hidden"} or type(value["ready"]) is not bool:
            return None
        if value["refreshBlockReason"] is not None and (not isinstance(value["refreshBlockReason"], str) or value["refreshBlockReason"] not in _REASONS):
            return None
        if not _valid_receipt(value["reloadReceipt"]):
            return None
    if kind == "otef_staff_remote_refresh_ack":
        rejected_reason = value["reason"]
        if not ((value["result"] == "accepted" and rejected_reason is None) or
                (value["result"] == "rejected" and isinstance(rejected_reason, str) and rejected_reason in _REJECTIONS)):
            return None
    if kind == "otef_staff_remote_disconnected":
        return None  # This event is generated only by the server.
    return dict(value)


def _group(prefix, *parts):
    suffix = "_".join(parts)
    return "staff_remote_" + prefix + ("_" + suffix if suffix else "")


def _target_group(remote_id, instance_id, connection_seq):
    identity = f"{remote_id}:{instance_id}:{connection_seq}".encode("ascii")
    return _group("target", hashlib.sha256(identity).hexdigest())


def _consumer_groups(consumer):
    groups = getattr(consumer, "_staff_remote_groups", None)
    if groups is None:
        groups = set()
        consumer._staff_remote_groups = groups
    return groups


async def _join(consumer, group):
    groups = _consumer_groups(consumer)
    if group not in groups:
        await consumer.channel_layer.group_add(group, consumer.channel_name)
        groups.add(group)


async def _renew_groups(consumer):
    sleep = getattr(consumer, "_staff_remote_sleep", asyncio.sleep)
    while True:
        await sleep(3600)
        for group in tuple(_consumer_groups(consumer)):
            await consumer.channel_layer.group_add(group, consumer.channel_name)


def _ensure_renewal(consumer):
    task = getattr(consumer, "_staff_remote_renewal", None)
    if task is None or task.done():
        consumer._staff_remote_renewal = asyncio.create_task(_renew_groups(consumer))


async def send_staff_remote_management(consumer, event):
    await consumer.send(text_data=json.dumps(event, separators=(",", ":")))


async def handle_staff_remote_management(consumer, data):
    """Validate and route a management message; return True when recognized."""
    kind = data.get("type") if isinstance(data, dict) else None
    if kind not in _SCHEMAS:
        return False
    if getattr(consumer, "channel_type", None) != "otef" or getattr(consumer, "room_group_name", None) != "otef_channel":
        return True
    message = validate_staff_remote_message(data)
    if message is None:
        return True
    role = getattr(consumer, "_staff_remote_role", None)
    if kind == "otef_staff_remote_subscribe":
        if role not in (None, "observer"):
            return True
        source = message["sourceId"]
        if role is None:
            consumer._staff_remote_role = "observer"
            consumer._staff_remote_source = source
            await _join(consumer, _group("observer", source))
            await _join(consumer, _group("observers_all"))
            _ensure_renewal(consumer)
        elif consumer._staff_remote_source != source:
            return True
        query = {"type": "otef_staff_remote_status_query", "table": "otef", "sourceId": source}
        await consumer.channel_layer.group_send(_group("producers"), {"type": "staff_remote_management_event", "message": query})
        return True
    if kind in {"otef_staff_remote_status_query", "otef_staff_remote_refresh"}:
        if role != "observer" or message["sourceId"] != getattr(consumer, "_staff_remote_source", None):
            return True
        if kind.endswith("status_query"):
            await consumer.channel_layer.group_send(_group("producers"), {"type": "staff_remote_management_event", "message": message})
        else:
            target = _target_group(message["remoteId"], message["instanceId"], message["connectionSeq"])
            await consumer.channel_layer.group_send(target, {"type": "staff_remote_management_event", "message": message})
        return True
    if kind in {"otef_staff_remote_status", "otef_staff_remote_refresh_ack"}:
        if role not in (None, "producer"):
            return True
        if kind == "otef_staff_remote_refresh_ack" and role is None:
            return True
        remote, instance, seq = message["remoteId"], message["instanceId"], str(message["connectionSeq"])
        identity = (remote, instance, seq)
        if role is None:
            consumer._staff_remote_role = "producer"
            consumer._staff_remote_identity = identity
            consumer._staff_remote_last_lease_seq = 0
            await _join(consumer, _group("producers"))
            await _join(consumer, _target_group(remote, instance, int(seq)))
            _ensure_renewal(consumer)
        elif getattr(consumer, "_staff_remote_identity", None) != identity:
            return True
        if kind == "otef_staff_remote_status":
            lease_seq = message["leaseSeq"]
            if lease_seq <= consumer._staff_remote_last_lease_seq:
                return True
            consumer._staff_remote_last_lease_seq = lease_seq
        elif role != "producer":
            return True
        if kind == "otef_staff_remote_status":
            await consumer.channel_layer.group_send(_group("observers_all"), {"type": "staff_remote_management_event", "message": message})
        else:
            await consumer.channel_layer.group_send(_group("observer", message["sourceId"]), {"type": "staff_remote_management_event", "message": message})
        return True
    return True


async def disconnect_staff_remote_management(consumer):
    task = getattr(consumer, "_staff_remote_renewal", None)
    if task is not None:
        task.cancel()
        consumer._staff_remote_renewal = None
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    role = getattr(consumer, "_staff_remote_role", None)
    try:
        if role == "producer":
            remote, instance, seq = consumer._staff_remote_identity
            event = {"type": "otef_staff_remote_disconnected", "table": "otef", "remoteId": remote,
                     "instanceId": instance, "connectionSeq": int(seq)}
            await consumer.channel_layer.group_send(_group("observers_all"), {"type": "staff_remote_management_event", "message": event})
    except Exception:
        # Presence notification is best-effort; cleanup must still complete.
        pass
    groups = tuple(_consumer_groups(consumer))
    try:
        await asyncio.gather(*(consumer.channel_layer.group_discard(group, consumer.channel_name) for group in groups),
                             return_exceptions=True)
    finally:
        consumer._staff_remote_groups = set()
