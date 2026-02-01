#!/usr/bin/env python3
"""
Layer Parser Report Generator

Generates a detailed report of all layer groups and layers, including
parsed .lyrx styling information for manual inspection.

Usage:
  python generate_layer_report.py --source /path/to/source/layers --output report.md
"""

import json
import argparse
from pathlib import Path
from typing import Dict, List, Optional
import sys
import io

# Fix Windows console encoding issues
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# Import from the modularized package
sys.path.insert(0, str(Path(__file__).parent))
try:
    from otef_layer_processing.styles import find_lyrx_file, parse_lyrx_style
    from otef_layer_processing.geo import get_geometry_type
    from otef_layer_processing.orchestrator import compute_file_hash
except ImportError as e:
    print(f"Error: Could not import modularize package: {e}")
    sys.exit(1)

# Helper functions that were in process_layers.py
def normalize_layer_id(layer_name: str) -> str:
    return layer_name.lower().replace(" ", "_").replace("-", "_")

def get_file_size_mb(path: Path) -> float:
    if path.exists():
        return path.stat().st_size / (1024 * 1024)
    return 0.0

def count_features(geojson_path: Path) -> int:
    try:
        with open(geojson_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return len(data.get("features", []))
    except Exception:
        return 0

def should_convert_to_pmtiles(geojson_path: Path, layer_id: str = None) -> bool:
    # Match logic in orchestrator: 15MB threshold
    return get_file_size_mb(geojson_path) > 15

PMTILES_SKIP_LAYER_IDS = set()

def scan_layer_packs(source_dir: Path) -> List[Path]:
    """Discover layer pack directories in source/layers/ or root."""
    packs = []
    # Check if we are pointing to the base source dir or the layers subfolder
    source_layers = source_dir / "layers" if (source_dir / "layers").exists() else source_dir

    if not source_layers.exists():
        return packs

    for item in source_layers.iterdir():
        if item.is_dir() and not item.name.startswith("."):
            gis_dir = item / "gis" if (item / "gis").exists() else item
            geo_files = list(gis_dir.glob("*.json")) + list(gis_dir.glob("*.geojson"))
            if geo_files:
                packs.append(item)
    return sorted(packs)


def format_color(color_hex: str, opacity: float = None) -> str:
    """Format color for display."""
    if opacity is not None and opacity != 1.0:
        return f"{color_hex} (opacity: {opacity:.2f})"
    return color_hex


def format_style_config(style: Dict) -> str:
    """Format style configuration for display."""
    lines = []

    if style.get("renderer") == "simple":
        lines.append("**Renderer Type:** Simple (single style for all features)")
        default = style.get("defaultStyle", {})
        if default:
            lines.append("**Default Style:**")
            if default.get("fillColor"):
                lines.append(
                    f"  - Fill: {format_color(default['fillColor'], default.get('fillOpacity'))}"
                )
            if default.get("strokeColor"):
                lines.append(
                    f"  - Stroke: {format_color(default['strokeColor'], default.get('strokeOpacity', 1.0))} (width: {default.get('strokeWidth', 1.0)})"
                )

        # Show full symbol stack summary
        full_layers = style.get("fullSymbolLayers", [])
        if full_layers:
            lines.append(f"**Full Symbol Stack:** {len(full_layers)} layer(s)")
            layer_types = {}
            for layer in full_layers:
                ltype = layer.get("type", "unknown")
                layer_types[ltype] = layer_types.get(ltype, 0) + 1
            if layer_types:
                type_summary = ", ".join(
                    [f"{k}: {v}" for k, v in sorted(layer_types.items())]
                )
                lines.append(f"  - Types: {type_summary}")

    elif style.get("renderer") == "uniqueValue":
        lines.append("**Renderer Type:** Unique Value (attribute-based styling)")
        unique = style.get("uniqueValues", {})
        fields = unique.get("fields", [])
        field = unique.get("field", "unknown")  # Backward compat

        if fields and len(fields) > 1:
            lines.append(f"**Fields:** {', '.join([f'`{f}`' for f in fields])}")
        else:
            lines.append(f"**Field:** `{field}`")

        classes = unique.get("classes", [])
        lines.append(f"**Classes:** {len(classes)}")
        for i, cls in enumerate(classes, 1):
            values = cls.get("values", [])
            value = cls.get("value", "")  # Backward compat
            label = cls.get("label", value)
            cls_style = cls.get("style", {})

            # Show multi-field values if present
            if values and len(values) > 0 and len(values[0]) > 1:
                value_str = ", ".join([f"`{v}`" for v in values[0]])
                lines.append(f"  {i}. **{label}** (values: {value_str})")
            else:
                lines.append(f"  {i}. **{label}** (value: `{value}`)")

            if cls_style.get("fillColor"):
                lines.append(
                    f"     - Fill: {format_color(cls_style['fillColor'], cls_style.get('fillOpacity'))}"
                )
            if cls_style.get("strokeColor"):
                lines.append(
                    f"     - Stroke: {format_color(cls_style['strokeColor'], cls_style.get('strokeOpacity', 1.0))} (width: {cls_style.get('strokeWidth', 1.0)})"
                )

            # Show symbol stack summary for this class
            full_layers = cls.get("fullSymbolLayers", [])
            if full_layers:
                lines.append(f"     - Symbol layers: {len(full_layers)}")
                layer_types = {}
                for layer in full_layers:
                    ltype = layer.get("type", "unknown")
                    layer_types[ltype] = layer_types.get(ltype, 0) + 1
                if layer_types:
                    type_summary = ", ".join(
                        [f"{k}: {v}" for k, v in sorted(layer_types.items())]
                    )
                    lines.append(f"       - Types: {type_summary}")

                # Report hatches/dashes specifically if present
                if cls_style.get("dashArray"):
                    lines.append(f"       - Dash pattern: {cls_style['dashArray']}")
                if cls_style.get("hatch"):
                    h = cls_style["hatch"]
                    lines.append(f"       - Hatch: {h['color']} (rot: {h['rotation']}, sep: {h['separation']})")

    # Labels
    labels = style.get("labels")
    if labels:
        lines.append("**Labels:**")
        lines.append(f"  - Field: `{labels.get('field', 'unknown')}`")
        lines.append(f"  - Font: {labels.get('font', 'unknown')}")
        lines.append(f"  - Size: {labels.get('size', 'unknown')}pt")

    scale_range = style.get("scaleRange")
    if scale_range:
        min_scale = scale_range.get("minScale")
        max_scale = scale_range.get("maxScale")
        lines.append("**Scale Range:**")
        lines.append(
            f"  - Min scale: {min_scale if min_scale is not None else 'not set'}"
        )
        lines.append(
            f"  - Max scale: {max_scale if max_scale is not None else 'not set'}"
        )

    return "\n".join(lines) if lines else "No style information available"


def generate_report(source_dir: Path, output_path: Path):
    """Generate detailed layer report."""

    print(f"Scanning layer packs in: {source_dir}")
    packs = scan_layer_packs(source_dir)

    if not packs:
        print(f"No layer packs found in {source_dir}")
        return

    print(f"Found {len(packs)} layer pack(s)")

    report_lines = []
    report_lines.append("# Layer Parser Report")
    report_lines.append("")
    report_lines.append(f"Generated from: `{source_dir}`")
    report_lines.append("")
    report_lines.append("---")
    report_lines.append("")

    for pack_dir in packs:
        pack_id = pack_dir.name
        print(f"\nProcessing pack: {pack_id}")

        report_lines.append(f"## Layer Group: `{pack_id}`")
        report_lines.append("")

        # Find all GeoJSON files
        gis_dir = pack_dir / "gis"
        styles_dir = pack_dir / "styles"

        geojson_files = []
        if gis_dir.exists():
            geojson_files.extend(gis_dir.glob("*.json"))
            geojson_files.extend(gis_dir.glob("*.geojson"))
        else:
            geojson_files.extend(pack_dir.glob("*.json"))
            geojson_files.extend(pack_dir.glob("*.geojson"))

        if not geojson_files:
            report_lines.append("*No GeoJSON files found in this pack.*")
            report_lines.append("")
            continue

        report_lines.append(f"**Total Layers:** {len(geojson_files)}")
        report_lines.append("")

        for geojson_file in sorted(geojson_files):
            layer_name = geojson_file.stem
            layer_id = normalize_layer_id(layer_name)
            full_layer_id = f"{pack_id}.{layer_id}"

            print(f"  Processing layer: {layer_name}")

            report_lines.append(f"### Layer: `{layer_name}`")
            report_lines.append("")
            report_lines.append(f"**Full ID:** `{full_layer_id}`")
            report_lines.append(f"**File:** `{geojson_file.name}`")
            report_lines.append("")

            # File information
            file_size_mb = get_file_size_mb(geojson_file)
            feature_count = count_features(geojson_file)
            geometry_type = get_geometry_type(geojson_file)
            needs_pmtiles = should_convert_to_pmtiles(geojson_file, layer_id)
            skipped_pmtiles = layer_id in PMTILES_SKIP_LAYER_IDS

            report_lines.append("**File Information:**")
            report_lines.append(f"  - Size: {file_size_mb:.2f} MB")
            report_lines.append(f"  - Features: {feature_count:,}")
            report_lines.append(f"  - Geometry Type: `{geometry_type}`")
            if skipped_pmtiles:
                report_lines.append("  - PMTiles Conversion: No (skipped by rule)")
            else:
                report_lines.append(
                    f"  - PMTiles Conversion: {'**Yes** (recommended)' if needs_pmtiles else 'No'}"
                )
            report_lines.append("")

            # Style information - use robust matching
            lyrx_file, match_method = find_lyrx_file(geojson_file, styles_dir)

            if lyrx_file and lyrx_file.exists():
                report_lines.append("**Style File:**")
                report_lines.append(f"  - Path: `{lyrx_file.relative_to(source_dir)}`")
                if match_method and match_method != "exact":
                    report_lines.append(
                        f"  - Match method: `{match_method}` (fallback match)"
                    )
                report_lines.append("")

                style_obj = parse_lyrx_style(lyrx_file)
                if style_obj:
                    style_config = style_obj.to_dict()
                    report_lines.append("**Parsed Style Configuration:**")
                    report_lines.append("")
                    report_lines.append(format_style_config(style_config))
                    report_lines.append("")

                    # Validation
                    report_lines.append("**Parser Validation:**")
                    if style_config.get("type") != geometry_type:
                        report_lines.append(
                            f"  - ⚠️ **Warning:** Geometry type mismatch! Style says `{style_config.get('type')}`, but GeoJSON is `{geometry_type}`"
                        )
                    else:
                        report_lines.append(
                            f"  - ✓ Geometry type matches: `{geometry_type}`"
                        )

                    if style_config.get("renderer") == "uniqueValue":
                        unique = style_config.get("uniqueValues", {})
                        fields = unique.get("fields", [])
                        field = unique.get("field", "")
                        if fields:
                            if len(fields) > 1:
                                report_lines.append(
                                    f"  - ✓ Unique value renderer using {len(fields)} field(s): {', '.join([f'`{f}`' for f in fields])}"
                                )
                            else:
                                report_lines.append(
                                    f"  - ✓ Unique value renderer using field: `{field}`"
                                )
                        elif field:
                            report_lines.append(
                                f"  - ✓ Unique value renderer using field: `{field}`"
                            )
                        classes = unique.get("classes", [])
                        report_lines.append(
                            f"  - ✓ Found {len(classes)} style class(es)"
                        )

                    # Check for null geometry warning
                    if geometry_type == "unknown":
                        report_lines.append(
                            f"  - ⚠️ **Warning:** GeoJSON has null geometries - check data source"
                        )

                    report_lines.append("")
                else:
                    report_lines.append(
                        "**Style File:** ⚠️ **Warning:** Failed to parse .lyrx file"
                    )
                    report_lines.append("")
            else:
                report_lines.append(
                    "**Style File:** ⚠️ **Warning:** No .lyrx file found for this layer"
                )
                report_lines.append("")
                report_lines.append(
                    "**Default Style:** Will use fallback styling (gray fill, black stroke)"
                )
                report_lines.append("")

            # Add null geometry warning if applicable
            if geometry_type == "unknown":
                report_lines.append("**Data Validation:**")
                report_lines.append(
                    f"  - ⚠️ **Warning:** All geometries are null in this file - layer may be invalid"
                )
                report_lines.append("")

            report_lines.append("---")
            report_lines.append("")

    # Write report
    report_content = "\n".join(report_lines)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(report_content)

    print(f"\n✓ Report generated: {output_path}")
    print(f"  Total packs: {len(packs)}")
    total_layers = sum(
        (
            len(list((p / "gis").glob("*.json")) + list((p / "gis").glob("*.geojson")))
            if (p / "gis").exists()
            else len(list(p.glob("*.json")) + list(p.glob("*.geojson")))
        )
        for p in packs
    )
    print(f"  Total layers: {total_layers}")


def main():
    parser = argparse.ArgumentParser(description="Generate layer parser report")
    parser.add_argument("--source", required=True, help="Source layers directory")
    parser.add_argument(
        "--output", required=True, help="Output report file path (Markdown)"
    )

    args = parser.parse_args()

    source_dir = Path(args.source)
    output_path = Path(args.output)

    if not source_dir.exists():
        print(f"Error: Source directory does not exist: {source_dir}")
        sys.exit(1)

    generate_report(source_dir, output_path)


if __name__ == "__main__":
    main()
