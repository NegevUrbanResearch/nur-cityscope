"""Refresh existing NLI people fields from MAZAL Excel and rebuild search index."""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from xml.etree import ElementTree as ET

_DATE_TAIL = re.compile(r",\s*\d{4}(?:\s*-\s*\d{4})?\s*$")
_TOKEN_SPLIT = re.compile(r"[\s,\-\u05be/]+")
_MMS_ID = re.compile(r"^\d{17,19}$")
_HEBREW = re.compile(r"[\u0590-\u05ff]")
_SUBFIELD_A = re.compile(r"\$\$a([^$]*)")
_YEAR_D = re.compile(r"\$\$d(\d{4})(?:\s*-\s*(\d{4}))?")
_YEAR_F = re.compile(r"\$\$f(\d{4})")
_YEAR_G = re.compile(r"\$\$g(\d{4})")

_HEADER_KEYS = {
    "MMSID": "mmsid",
    "Hebrew Name (100)": "he100",
    "English Name (100)": "en100",
    "400": "see400",
    "Arabic Name (100)": "ar100",
    "Russian Name (100)": "ru100",
    "375": "gender375",
    "046": "dates046",
}

_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def spoken_catalog_name(raw: str) -> str:
    from nli_pack_prep import parse_marc_name  # function-local, avoid cycle

    heading = parse_marc_name(raw)
    heading = _DATE_TAIL.sub("", heading).strip(" ,")
    if heading.count(",") != 1:
        return ""
    last, first = [part.strip() for part in heading.split(",", 1)]
    if not last or not first:
        return ""
    return f"{first} {last}".strip()


def token_set(name: str) -> Set[str]:
    tokens: Set[str] = set()
    for part in _TOKEN_SPLIT.split(str(name or "").strip()):
        token = part.strip().strip("()")
        if token:
            tokens.add(token)
    return tokens


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    return False


def _gis_english_is_superset(gis_name: str, nli_spoken: str) -> bool:
    gis_tokens = token_set(gis_name)
    nli_tokens = token_set(nli_spoken)
    return bool(nli_tokens) and nli_tokens <= gis_tokens and gis_tokens > nli_tokens


def _catalog_last_first(raw: str) -> tuple[str, str]:
    from nli_pack_prep import parse_marc_name  # function-local, avoid cycle

    heading = parse_marc_name(raw)
    heading = _DATE_TAIL.sub("", heading).strip(" ,")
    if not heading or "," not in heading:
        return "", ""
    if _HEBREW.search(heading):
        return "", ""
    last, first = [part.strip() for part in heading.split(",", 1)]
    return last, first


def _years_from_record(record: Dict[str, str]) -> tuple[Optional[int], Optional[int]]:
    birth: Optional[int] = None
    death: Optional[int] = None
    for field in (record.get("dates046") or "", record.get("he100") or "", record.get("en100") or ""):
        if birth is None or death is None:
            match_f = _YEAR_F.search(field)
            match_g = _YEAR_G.search(field)
            if match_f and birth is None:
                birth = int(match_f.group(1))
            if match_g and death is None:
                death = int(match_g.group(1))
        if birth is None or death is None:
            match_d = _YEAR_D.search(field)
            if match_d:
                if birth is None and match_d.group(1):
                    birth = int(match_d.group(1))
                if death is None and match_d.group(2):
                    death = int(match_d.group(2))
    return birth, death


def _gender_from_375(raw: str) -> str:
    text = str(raw or "").lower()
    if "female" in text:
        return "F"
    if "male" in text:
        return "M"
    return ""


def _spoken_subfield_a_values(raw: str) -> List[str]:
    values: List[str] = []
    for part in _SUBFIELD_A.findall(str(raw or "")):
        spoken = spoken_catalog_name(f"$$a{part}")
        if spoken:
            values.append(spoken)
    if not values and raw:
        spoken = spoken_catalog_name(raw)
        if spoken:
            values.append(spoken)
    return values


def records_from_header_rows(header: list[str], rows: list[list]) -> dict[str, dict]:
    index_by_key: Dict[str, int] = {}
    for i, cell in enumerate(header):
        key = _HEADER_KEYS.get(str(cell or "").strip())
        if key is not None:
            index_by_key[key] = i

    def cell(row: list, key: str) -> str:
        idx = index_by_key.get(key)
        if idx is None or idx >= len(row):
            return ""
        value = row[idx]
        return "" if value is None else str(value)

    out: Dict[str, dict] = {}
    mms_idx = index_by_key.get("mmsid")
    if mms_idx is None:
        return out
    for row in rows:
        mms_id = cell(row, "mmsid").strip()
        if not _MMS_ID.fullmatch(mms_id):
            continue
        out[mms_id] = {
            "he100": cell(row, "he100"),
            "en100": cell(row, "en100"),
            "see400": cell(row, "see400"),
            "ar100": cell(row, "ar100"),
            "ru100": cell(row, "ru100"),
            "gender375": cell(row, "gender375"),
            "dates046": cell(row, "dates046"),
        }
    return out


def _col_index(cell_ref: str) -> int:
    letters = "".join(ch for ch in cell_ref if ch.isalpha())
    value = 0
    for ch in letters.upper():
        value = value * 26 + (ord(ch) - 64)
    return value - 1


def _sheet_rows(shared: List[str], sheet_xml: bytes) -> List[List[str]]:
    root = ET.fromstring(sheet_xml)
    rows_out: List[List[str]] = []
    for row_el in root.findall(".//m:sheetData/m:row", _NS):
        cells: Dict[int, str] = {}
        max_idx = -1
        for cell in row_el.findall("m:c", _NS):
            ref = cell.get("r") or ""
            idx = _col_index(ref) if ref else max_idx + 1
            max_idx = max(max_idx, idx)
            cell_type = cell.get("t")
            value_el = cell.find("m:v", _NS)
            if value_el is None or value_el.text is None:
                text = ""
            elif cell_type == "s":
                text = shared[int(value_el.text)]
            else:
                text = value_el.text
            cells[idx] = text
        if max_idx < 0:
            rows_out.append([])
            continue
        rows_out.append([cells.get(i, "") for i in range(max_idx + 1)])
    return rows_out


def load_mazal_records(path: Path) -> dict[str, dict]:
    """Read Sheet1 from an OOXML .xlsx via stdlib zip+xml."""
    with zipfile.ZipFile(path) as archive:
        shared: List[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in shared_root.findall("m:si", _NS):
                texts = [node.text or "" for node in item.findall(".//m:t", _NS)]
                shared.append("".join(texts))
        sheet_name = "xl/worksheets/sheet1.xml"
        if sheet_name not in archive.namelist():
            return {}
        rows = _sheet_rows(shared, archive.read(sheet_name))
    if not rows:
        return {}
    header = rows[0]
    return records_from_header_rows(header, rows[1:])


def apply_nli_person_fields(collection: Dict[str, Any], records_by_mms: Dict[str, dict]) -> dict:
    updated = 0
    skipped_unmatched = 0
    aliases_by_pid: Dict[str, List[str]] = {}

    for feature in collection.get("features") or []:
        props = feature.get("properties")
        if not isinstance(props, dict):
            continue
        mms_id = str(props.get("mms_id") or "").strip()
        record = records_by_mms.get(mms_id) if mms_id else None
        if record is None:
            skipped_unmatched += 1
            continue

        aliases: List[str] = []
        he_spoken = spoken_catalog_name(record.get("he100") or "")
        if he_spoken:
            props["hebrew_name"] = he_spoken

        en_spoken = spoken_catalog_name(record.get("en100") or "")
        kept_gis_english = False
        if en_spoken:
            gis_name = str(props.get("name") or "")
            if _gis_english_is_superset(gis_name, en_spoken):
                kept_gis_english = True
            else:
                props["name"] = en_spoken

        last, first = _catalog_last_first(record.get("en100") or "")
        if last and first:
            if _is_blank(props.get("first_name")):
                props["first_name"] = first
            if _is_blank(props.get("last_name")):
                props["last_name"] = last

        if _is_blank(props.get("age")):
            birth, death = _years_from_record(record)
            if birth is not None and death is not None and death >= birth:
                props["age"] = str(death - birth)

        if props.get("gender") in ("", None, "?"):
            gender = _gender_from_375(record.get("gender375") or "")
            if gender:
                props["gender"] = gender

        for spoken in _spoken_subfield_a_values(record.get("see400") or ""):
            aliases.append(spoken)
        for field in ("ar100", "ru100"):
            spoken = spoken_catalog_name(record.get(field) or "")
            if spoken:
                aliases.append(spoken)
        if kept_gis_english and en_spoken:
            aliases.append(en_spoken)

        final_names = {
            str(props.get("hebrew_name") or "").strip(),
            str(props.get("name") or "").strip(),
        }
        unique_aliases: List[str] = []
        seen: Set[str] = set()
        for alias in aliases:
            trimmed = alias.strip()
            if not trimmed or trimmed in final_names or trimmed in seen:
                continue
            seen.add(trimmed)
            unique_aliases.append(trimmed)
        if unique_aliases:
            aliases_by_pid[str(props.get("pid"))] = unique_aliases

        feature["properties"] = props
        updated += 1

    return {
        "updated": updated,
        "skipped_unmatched": skipped_unmatched,
        "aliases_by_pid": aliases_by_pid,
    }


def build_people_search_index(
    collection: Dict[str, Any],
    dataset_version: str,
    aliases_by_pid: dict[str, list[str]] | None = None,
) -> dict:
    aliases_by_pid = aliases_by_pid or {}
    people: List[dict] = []
    for feature in collection.get("features") or []:
        props = feature.get("properties") or {}
        pid = str(props.get("pid") or "").strip()
        if not pid:
            continue
        name_forms: List[str] = []
        seen: Set[str] = set()
        for value in (
            props.get("hebrew_name"),
            props.get("name"),
            *(aliases_by_pid.get(pid) or []),
        ):
            trimmed = str(value or "").strip()
            if not trimmed or trimmed in seen:
                continue
            seen.add(trimmed)
            name_forms.append(trimmed)
        people.append(
            {
                "pid": pid,
                "nameForms": name_forms,
                "location": str(props.get("location") or "").strip(),
                "sublocation": str(props.get("sublocation") or "").strip(),
                "status": str(props.get("status") or "").strip(),
                "hasArchiveRecord": bool(props.get("nli_url") or props.get("mms_id")),
            }
        )
    return {"datasetVersion": dataset_version, "people": people}


def write_people_search_index(
    collection: Dict[str, Any],
    dataset_version: str,
    path: Path,
    aliases_by_pid: dict[str, list[str]] | None = None,
) -> dict:
    payload = build_people_search_index(collection, dataset_version, aliases_by_pid)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload
