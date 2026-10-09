"""Validation and revisioned persistence for Road 232 sign settings."""

import math
import re

from django.db import transaction

from .models import OTEFViewportState

MAX_REVISION = 9007199254740991
UUID_PATTERN = re.compile(r"^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")
EMPTY_ROAD_SIGN_SETTINGS = {"version": 1, "outputs": {"left": [], "right": []}}


class RoadSignRejected(ValueError):
    """Raised when a Road 232 document or command is malformed."""

    def __init__(self, error="invalid Road 232 sign settings"):
        self.error = error
        super().__init__(error)


class RoadSignConflict(Exception):
    """Raised when a write uses an old revision."""

    def __init__(self, settings, revision):
        self.settings = settings
        self.revision = revision
        super().__init__("Road 232 sign settings changed on another client")


def _number(value, minimum, maximum):
    if type(value) is int:
        return minimum <= value <= maximum
    return type(value) is float and math.isfinite(value) and minimum <= value <= maximum


def normalize_road_sign_settings(raw):
    """Validate and return the canonical v1 settings document.

    An untouched database value is represented by ``{}``; snapshots expose the
    explicit empty v1 document without writing that normalization back.
    """
    if raw == {}:
        return {"version": 1, "outputs": {"left": [], "right": []}}
    if not isinstance(raw, dict) or set(raw) != {"version", "outputs"} or type(raw.get("version")) is not int or raw["version"] != 1:
        raise RoadSignRejected("settings must be a version 1 document")
    outputs = raw.get("outputs")
    if not isinstance(outputs, dict) or set(outputs) not in ({"left", "right"}, {"left", "right", "gis"}):
        raise RoadSignRejected("outputs must contain left and right, with optional gis")

    normalized = {"version": 1, "outputs": {}}
    seen = set()
    for output in ("left", "right", *(["gis"] if "gis" in outputs else [])):
        signs = outputs[output]
        if not isinstance(signs, list) or len(signs) > 64:
            raise RoadSignRejected(f"{output} must contain at most 64 signs")
        normalized_signs = []
        for sign in signs:
            if not isinstance(sign, dict) or set(sign) != {
                "id", "x", "y", "scale", "rotateDeg", "theme", "visible", "leader"
            }:
                raise RoadSignRejected("each sign must contain exactly the supported fields")
            sign_id = sign["id"]
            if not isinstance(sign_id, str) or not UUID_PATTERN.fullmatch(sign_id):
                raise RoadSignRejected("sign id must be a UUID")
            identity = sign_id.lower()
            if identity in seen:
                raise RoadSignRejected("sign ids must be unique")
            seen.add(identity)
            if not _number(sign["x"], 0, 1920) or not _number(sign["y"], 0, 1080):
                raise RoadSignRejected("sign center must be within the source output")
            if not _number(sign["scale"], 0.01, 3):
                raise RoadSignRejected("scale must be between 0.01 and 3")
            if not _number(sign["rotateDeg"], -180, 180):
                raise RoadSignRejected("rotation must be between -180 and 180 degrees")
            if sign["theme"] not in ("dark", "original"):
                raise RoadSignRejected("theme must be dark or original")
            if type(sign["visible"]) is not bool:
                raise RoadSignRejected("visible must be a boolean")
            leader = sign["leader"]
            if not isinstance(leader, dict) or set(leader) != {"enabled", "x", "y"}:
                raise RoadSignRejected("leader must contain exactly enabled, x, and y")
            if type(leader["enabled"]) is not bool:
                raise RoadSignRejected("leader enabled must be a boolean")
            if not _number(leader["x"], 0, 1920) or not _number(leader["y"], 0, 1080):
                raise RoadSignRejected("leader endpoint must be within the source output")
            normalized_signs.append({
                "id": sign_id,
                "x": sign["x"],
                "y": sign["y"],
                "scale": sign["scale"],
                "rotateDeg": sign["rotateDeg"],
                "theme": sign["theme"],
                "visible": sign["visible"],
                "leader": {"enabled": leader["enabled"], "x": leader["x"], "y": leader["y"]},
            })
        normalized["outputs"][output] = normalized_signs
    return normalized


def write_road_sign_settings(table_name, settings, base_revision):
    """Atomically replace one table's signs document using revision CAS."""
    canonical = normalize_road_sign_settings(settings)
    if type(base_revision) is not int or not 0 <= base_revision <= MAX_REVISION:
        raise RoadSignRejected("baseRevision must be a safe nonnegative integer")

    with transaction.atomic():
        state = OTEFViewportState.objects.select_for_update().get(table__name=table_name)
        current = normalize_road_sign_settings(state.road_sign_settings)
        revision = state.road_sign_revision
        if revision != base_revision or revision >= MAX_REVISION:
            raise RoadSignConflict(current, revision)
        state.road_sign_settings = canonical
        state.road_sign_revision = revision + 1
        state.save(update_fields=["road_sign_settings", "road_sign_revision", "updated_at"])
        return canonical, state.road_sign_revision
