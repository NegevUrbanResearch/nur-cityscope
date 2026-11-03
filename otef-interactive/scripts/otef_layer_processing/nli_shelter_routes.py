"""Validate pinned marker-derived Nova destination associations before staging."""

import hashlib
import json
from pathlib import Path

DEFAULT_ROUTE_FIXTURE = (
    Path(__file__).resolve().parents[1] / "fixtures/nli-nova-route-shelters.json"
)


def prepare_route_bindings(
    routes_path, shelters, people, fixture_path=None, *, required=False
):
    # Synthetic shelter-only callers retain their existing contract. A pack
    # containing Nova routes must validate its exact artifact before any write.
    if not routes_path.is_file():
        if fixture_path is not None or required:
            raise ValueError("Nova route artifact is missing")
        return {}
    fixture = json.loads(
        Path(fixture_path or DEFAULT_ROUTE_FIXTURE).read_text(encoding="utf-8")
    )
    raw = routes_path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if fixture.get("schemaVersion") != 1 or fixture.get("novaRoutesSHA256") != digest:
        raise ValueError("Nova route crosswalk hash does not match accepted routes")
    routes = json.loads(raw).get("features", [])
    route_ids = [f.get("properties", {}).get("OBJECTID") for f in routes]
    if (
        any(type(rid) is not int for rid in route_ids)
        or len(set(route_ids)) != len(route_ids)
    ):
        raise ValueError("Nova route OBJECTIDs must be unique integers")
    route_by_id = {f["properties"]["OBJECTID"]: f for f in routes}
    person_by_pid = {
        str(f.get("properties", {}).get("pid")): f
        for f in people.get("features", [])
    }
    groups = {s["id"]: s for s in shelters}
    seen_routes, seen_people = set(), set()
    bindings = fixture.get("bindings", [])
    if not isinstance(bindings, list) or not bindings:
        raise ValueError("Nova route crosswalk requires bindings")
    for binding in bindings:
        rid, pid, sid = (
            binding.get("routeObjectId"),
            binding.get("personPid"),
            binding.get("shelterId"),
        )
        if (
            type(rid) is not int
            or rid not in route_ids
            or rid in seen_routes
            or not isinstance(pid, str)
            or pid in seen_people
            or sid not in groups
            or pid not in groups[sid]["personPids"]
        ):
            raise ValueError(
                "Nova route binding must resolve uniquely to its direct shelter member"
            )
        person, route = person_by_pid[pid], route_by_id[rid]
        properties = person.get("properties", {})
        if "personName" in binding and binding["personName"] != properties.get("name"):
            raise ValueError("Nova binding person name provenance changed")
        if (
            "originalMarkerCoordinates" in binding
            and binding["originalMarkerCoordinates"]
            != [properties.get("source_lon"), properties.get("source_lat")]
        ):
            raise ValueError("Nova binding original marker provenance changed")
        if (
            "routeLabel" in binding
            and binding["routeLabel"] != route["properties"].get("Name")
        ):
            raise ValueError("Nova binding route label provenance changed")
        if (
            "destinationCoordinates" in binding
            and binding["destinationCoordinates"]
            != route.get("geometry", {}).get("coordinates", [None])[-1]
        ):
            raise ValueError("Nova binding destination provenance changed")
        seen_routes.add(rid)
        seen_people.add(pid)
    if "unmappedPersonPids" in fixture:
        unmapped = fixture["unmappedPersonPids"]
        members = {pid for shelter in shelters for pid in shelter["personPids"]}
        if (
            not isinstance(unmapped, list)
            or len(set(unmapped)) != len(unmapped)
            or seen_people.intersection(unmapped)
            or seen_people.union(unmapped) != members
        ):
            raise ValueError("Nova crosswalk must account for every direct shelter member")
    for sid, shelter in groups.items():
        shelter["novaRouteObjectIds"] = [
            str(rid)
            for rid in sorted(
                b["routeObjectId"] for b in bindings if b["shelterId"] == sid
            )
        ]
    return {"novaRoutesSHA256": digest}
