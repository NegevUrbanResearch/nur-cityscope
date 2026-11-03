"""Validation and isolated handling for opt-in tablet projection traces."""
import json
import logging
import math
import re
import sys
import uuid


class CheckedTraceHandler(logging.StreamHandler):
    def handleError(self, record):
        # Normal StreamHandler swallows write failures; an ACK requires emission.
        raise


projection_trace_logger = logging.getLogger("websocket_app.projection_trace")
projection_trace_logger.setLevel(logging.INFO)
projection_trace_logger.propagate = False
if not projection_trace_logger.handlers:
    _trace_handler = CheckedTraceHandler(sys.stdout)
    _trace_handler.setLevel(logging.INFO)
    _trace_handler.setFormatter(logging.Formatter("%(message)s"))
    projection_trace_logger.addHandler(_trace_handler)
_TRACE_PREFIX = "[OTEF PROJECTION TRACE] "
_TRACE_KINDS = {"pointer", "capture", "selection", "redraw", "geometry", "gesture", "viewport", "receipt", "lifecycle"}
_TEXT_FIELDS = {"phase", "reason", "role", "surface", "output", "mode", "pointerType", "baselineType", "receiptType", "visibilityState"}
_NUMBER_FIELDS = {"clientX", "clientY", "rectX", "rectY", "rectWidth", "rectHeight", "viewX", "viewY", "viewWidth", "viewHeight", "durationMs", "scale", "width", "height", "devicePixelRatio"}
_INTEGER_FIELDS = {"pointerId", "buttons", "index", "revision", "schemaVersion", "columns", "rows", "redrawId", "gestureId"}
_BOOLEAN_FIELDS = {"primary", "captured", "accepted", "live", "visible", "dragging", "connected"}
_DETAIL_FIELDS = _TEXT_FIELDS | _NUMBER_FIELDS | _INTEGER_FIELDS | _BOOLEAN_FIELDS | {"button", "indices"}
_TEXT_CHOICES = {
    "output": {"left", "right"}, "pointerType": {"mouse", "touch", "pen", "unknown"},
    "surface": {"graph", "warp", "dialog", "page"},
}
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def _is_int(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def _valid_detail(detail):
    if not isinstance(detail, dict) or set(detail) - _DETAIL_FIELDS:
        return False
    for key, value in detail.items():
        if key in _TEXT_FIELDS:
            if not isinstance(value, str) or len(value) > 120 or _CONTROL.search(value):
                return False
            if key in _TEXT_CHOICES and value not in _TEXT_CHOICES[key]:
                return False
        elif key in _NUMBER_FIELDS:
            if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 1e12:
                return False
        elif key in _INTEGER_FIELDS:
            if not _is_int(value, 0, 2147483647):
                return False
        elif key == "button":
            if not _is_int(value, -1, 31):
                return False
        elif key == "indices":
            if not isinstance(value, list) or len(value) > 64 or any(not _is_int(item, 0, 255) for item in value):
                return False
        elif key in _BOOLEAN_FIELDS and type(value) is not bool:
            return False
    return True


def validate_projection_trace(data):
    """Return a JSON-safe trace batch, or None when any part is invalid."""
    required = {"type", "table", "version", "sessionId", "clientId", "seq", "dropped", "events"}
    if not isinstance(data, dict) or set(data) != required:
        return None
    if data["type"] != "otef_projection_trace" or data["table"] != "otef" or type(data["version"]) is not int or data["version"] != 1:
        return None
    for key in ("sessionId", "clientId"):
        value = data[key]
        if not isinstance(value, str):
            return None
        try:
            if str(uuid.UUID(value)) != value.lower():
                return None
        except (ValueError, AttributeError, TypeError):
            return None
    if not _is_int(data["seq"], 1, 2147483647) or not _is_int(data["dropped"], 0, 2147483647):
        return None
    events = data["events"]
    if not isinstance(events, list) or not 1 <= len(events) <= 64:
        return None
    for event in events:
        if not isinstance(event, dict) or set(event) != {"t", "kind", "detail"}:
            return None
        timestamp = event["t"]
        if type(timestamp) not in (int, float) or not math.isfinite(timestamp) or not 0 <= timestamp <= 1e12:
            return None
        if not isinstance(event["kind"], str) or event["kind"] not in _TRACE_KINDS or not _valid_detail(event["detail"]):
            return None
    try:
        if len(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 49152:
            return None
    except (TypeError, ValueError, UnicodeEncodeError):
        return None
    return data


async def handle_projection_trace(consumer, data):
    """Validate, emit one diagnostic log record, then ACK this socket only."""
    batch = validate_projection_trace(data) if consumer.room_group_name == "otef_channel" else None
    if batch is None:
        await consumer.send(text_data=json.dumps({"type": "otef_projection_trace_error", "version": 1, "reason": "invalid_batch"}))
        return
    try:
        line = _TRACE_PREFIX + json.dumps(batch, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        projection_trace_logger.info(line)
    except Exception:
        await consumer.send(text_data=json.dumps({"type": "otef_projection_trace_error", "version": 1, "reason": "log_failed"}))
        return
    await consumer.send(text_data=json.dumps({
        "type": "otef_projection_trace_ack", "version": 1,
        "sessionId": batch["sessionId"], "clientId": batch["clientId"], "seq": batch["seq"],
    }))
