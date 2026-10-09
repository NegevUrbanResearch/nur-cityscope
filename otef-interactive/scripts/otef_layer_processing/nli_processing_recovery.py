"""Per-operation output ownership and conflict-safe recovery for NLI processing."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path


def file_sha256(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def record_owned_postimage(journal_path: Path, target: Path, postimage_sha256: str | None) -> None:
    """Record a known serialized/staged postimage before its atomic replacement."""
    journal_path = Path(journal_path)
    target = Path(target).resolve()
    preimages_path = journal_path.with_name("preimages.json")
    preimages = json.loads(preimages_path.read_text(encoding="utf-8"))
    key = str(target)
    expected = preimages.get(key)
    if journal_path.is_file():
        for line in journal_path.read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            if record.get("target") == key:
                expected = record["postimageSha256"]
    actual = file_sha256(target)
    if actual != expected:
        raise RuntimeError(
            f"foreign output conflict before NLI processing write: {target} "
            f"(expected {expected or 'absent'}, found {actual or 'absent'})"
        )
    payload = json.dumps({"target": key, "preimageSha256": preimages.get(key),
                          "postimageSha256": postimage_sha256}, separators=(",", ":")).encode() + b"\n"
    descriptor = os.open(journal_path, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
    try:
        os.write(descriptor, payload)
    finally:
        os.close(descriptor)


def restore_owned_outputs(snapshot: dict, *, pack_ids: list[str] | None = None) -> list[str]:
    """Restore only outputs whose current bytes still match this operation's last postimage."""
    journal_path = snapshot["recovery_journal"]
    if not journal_path.is_file():
        return []
    latest = {}
    for line in journal_path.read_text(encoding="utf-8").splitlines():
        record = json.loads(line)
        latest[record["target"]] = record
    conflicts = []
    for target_text, record in latest.items():
        target = Path(target_text)
        if pack_ids is not None:
            pack_root = (Path(snapshot["output_root"]) / "nli").resolve()
            try:
                target.relative_to(pack_root)
            except ValueError:
                continue
            if "nli" not in pack_ids:
                continue
        actual = file_sha256(target)
        preimage = record["preimageSha256"]
        postimage = record["postimageSha256"]
        if actual == preimage:
            continue
        if actual != postimage:
            conflicts.append({"target": target_text, "expectedPostimageSha256": postimage,
                              "actualSha256": actual})
            continue
        saved = snapshot["file_copies"].get(target_text)
        if saved is None:
            target.unlink(missing_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + ".nli-restore-tmp")
            temporary.write_bytes(Path(saved).read_bytes())
            os.replace(temporary, target)
    if conflicts:
        evidence = Path(snapshot["dir"]) / "recovery-conflicts.json"
        evidence.write_text(json.dumps({"conflicts": conflicts}, indent=2) + "\n", encoding="utf-8")
        snapshot["recovery_required"] = True
        paths = ", ".join(item["target"] for item in conflicts)
        return [f"NLI rollback preserved conflicting foreign output(s): {paths}; recovery evidence: {evidence}"]
    return []


def restore_transaction_owned_outputs(
    journal_path: Path, backups: dict[Path, Path], destinations: list[Path]
) -> list[str]:
    """Restore buffered outputs only while they still match this transaction's postimage."""
    journal_path = Path(journal_path)
    latest = {}
    if journal_path.is_file():
        for line in journal_path.read_text(encoding="utf-8").splitlines():
            record = json.loads(line)
            latest[record["target"]] = record

    conflicts = []
    for destination in reversed(destinations):
        target_text = str(Path(destination).resolve())
        record = latest.get(target_text)
        if record is None:
            continue
        actual = file_sha256(Path(destination))
        preimage = record["preimageSha256"]
        postimage = record["postimageSha256"]
        if actual == preimage:
            continue
        if actual != postimage:
            conflicts.append({"target": target_text, "expectedPostimageSha256": postimage,
                              "actualSha256": actual})
            continue
        backup = backups.get(Path(destination))
        if backup is not None and backup.is_file():
            os.replace(backup, destination)
        elif preimage is None:
            Path(destination).unlink(missing_ok=True)
        else:
            conflicts.append({"target": target_text, "expectedPostimageSha256": postimage,
                              "actualSha256": actual, "reason": "owned preimage backup is missing"})

    if not conflicts:
        return []
    evidence = journal_path.with_name("recovery-conflicts.json")
    evidence.write_text(json.dumps({"conflicts": conflicts}, indent=2) + "\n", encoding="utf-8")
    paths = ", ".join(item["target"] for item in conflicts)
    return [f"NLI buffered rollback preserved conflicting foreign output(s): {paths}; recovery evidence: {evidence}"]
