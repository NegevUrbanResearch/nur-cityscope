from __future__ import annotations

import hashlib
from pathlib import Path


REQUIRED_INPUT_NAMES = frozenset({
    "recipe", "border", "road", "provenance", "metadata", "presenter",
    "sourceLines", "runtimeLines", "alarms", "investigationPolygons",
    "navigationFixture", "verifier", "digestCli", "beatClock", "timelineTransport",
})


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def capture_input_snapshot(repo_root: Path, named_paths: list[tuple[str, Path]]) -> tuple[list[dict], dict[str, bytes]]:
    """Read every preparation input once and return both its bytes and pinned identity."""
    root = Path(repo_root).resolve()
    identities = []
    contents = {}
    for name, raw_path in named_paths:
        path = Path(raw_path).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError(f"preparation input is missing or outside repository: {name}")
        data = path.read_bytes()
        contents[name] = data
        identity = {"name": name, "path": str(path), "byteSha256": sha256_bytes(data)}
        if name == "border":
            normalized = data.decode("utf-8").replace("\r\n", "\n").encode("utf-8")
            identity["normalizedLfSha256"] = sha256_bytes(normalized)
        identities.append(identity)
    return identities, contents


def validate_input_snapshot(identities: list[dict], repo_root: Path, *,
                            expected_names: set[str] | frozenset[str] | None = None,
                            installed_candidates: dict[str, str] | None = None) -> None:
    """Validate manifest identities and current bytes, allowing already-installed target candidates."""
    root = Path(repo_root).resolve()
    rows = {item.get("name"): item for item in identities if isinstance(item, dict)}
    if len(rows) != len(identities):
        raise ValueError("preparation input identities must have unique names")
    if expected_names is not None and set(rows) != set(expected_names):
        raise ValueError("prepared release input identity set is incomplete or unexpected")
    installed_candidates = installed_candidates or {}
    for name, item in rows.items():
        path = Path(item.get("path", "")).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError(f"prepared input identity is missing or outside repository: {name}")
        current = sha256_bytes(path.read_bytes())
        if current != item.get("byteSha256") and current != installed_candidates.get(name):
            raise ValueError(f"prepared input identity changed: {name}")
        if name == "border":
            normalized = sha256_bytes(path.read_bytes().replace(b"\r\n", b"\n"))
            if normalized != item.get("normalizedLfSha256"):
                raise ValueError("canonical border normalized identity changed")
