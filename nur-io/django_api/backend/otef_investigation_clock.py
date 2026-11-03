"""Shared state constructors for the OTEF investigation clock."""


def idle_investigation_clock(loop=False, revision=0):
    return {
        "phase": "idle",
        "membership": [],
        "beats": [],
        "loop": bool(loop),
        "positionMs": 0,
        "anchorMs": None,
        "seekKind": "none",
        "revision": int(revision),
    }
