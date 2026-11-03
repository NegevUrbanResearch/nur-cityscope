from __future__ import annotations

import contextlib
import errno
import json
import os
import secrets
import time
from pathlib import Path
from typing import Iterator

_LOCK_NAME = ".nli-route-mutation.lock"
_OWNER_NAME = ".nli-route-mutation-owner.json"
UNFINISHED_MARKER_NAME = ".nli-route-release-unfinished.json"
_MARKER_NAME = UNFINISHED_MARKER_NAME


@contextlib.contextmanager
def nli_mutation_lock(processed_layers_root: Path, *, owner_token: str | None = None,
                      recovery: bool = False) -> Iterator[str]:
    """Serialize NLI mutation and return an owner token for joined workers.

    A worker validates the token and probes the same OS lock without blocking.
    The parent must retain the lock until all workers using its token have finished.
    """
    root = Path(processed_layers_root).resolve()
    control = root.parent
    control.mkdir(parents=True, exist_ok=True)
    lock_path, owner_path = control / _LOCK_NAME, control / _OWNER_NAME
    handle = lock_path.open("a+b")
    acquired = False
    token: str | None = None
    try:
        _ensure_lock_byte(handle)
        if owner_token is not None:
            before = _read_owner(owner_path)
            if before.get("token") != owner_token or before.get("root") != str(root):
                raise RuntimeError("inherited NLI mutation owner token does not match locked root")
            if _try_acquire_os_lock(handle):
                _release_os_lock(handle)
                raise RuntimeError("inherited NLI owner is stale; no active OS lock is held")
            after = _read_owner(owner_path)
            if after != before or after.get("token") != owner_token or after.get("root") != str(root):
                raise RuntimeError("inherited NLI owner changed during active-lock validation")
            token = owner_token
        else:
            _acquire_os_lock(handle)
            acquired = True
            token = secrets.token_hex(32)
            _atomic_json(owner_path, {"token": token, "root": str(root), "pid": os.getpid()})
        marker = control / _MARKER_NAME
        if marker.exists() and not recovery:
            raise RuntimeError(f"unfinished NLI release blocks mutation: {marker}")
        yield token
    finally:
        try:
            if acquired:
                try:
                    if token is not None and _owner_matches(owner_path, token, root):
                        owner_path.unlink(missing_ok=True)
                finally:
                    _release_os_lock(handle)
        finally:
            handle.close()


def _read_owner(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError("inherited NLI mutation owner record is missing or invalid") from exc
    if not isinstance(value, dict):
        raise RuntimeError("inherited NLI mutation owner record is not an object")
    return value


def _owner_matches(path: Path, token: str, root: Path) -> bool:
    try:
        owner = _read_owner(path)
    except RuntimeError:
        return False
    return owner.get("token") == token and owner.get("root") == str(root)


def _ensure_lock_byte(handle) -> None:
    if os.name == "nt":
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()


def _try_acquire_os_lock(handle) -> bool:
    if os.name == "nt":
        import msvcrt
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            return True
        except OSError as exc:
            if exc.errno in {errno.EACCES, errno.EDEADLK}:
                return False
            raise
    import fcntl
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError as exc:
        if exc.errno in {errno.EACCES, errno.EAGAIN}:
            return False
        raise


def _acquire_os_lock(handle) -> None:
    if os.name == "nt":
        import msvcrt
        while True:
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                return
            except OSError:
                time.sleep(0.05)
    import fcntl
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)


def _release_os_lock(handle) -> None:
    if os.name == "nt":
        import msvcrt
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _atomic_json(path: Path, value: dict) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)
    if os.name != "nt":
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
