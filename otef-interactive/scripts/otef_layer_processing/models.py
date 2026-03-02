from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Any


def _simple_style_to_symbol_ir(simple_style: Dict[str, Any]) -> Dict[str, Any]:
    """Build minimal symbol IR from a simple style dict (fillColor, strokeColor, etc.)."""
    if not simple_style:
        return {"symbolLayers": []}
    layers: List[Dict[str, Any]] = []
    if simple_style.get("fillColor"):
        layers.append(
            {
                "type": "fill",
                "fillType": "solid",
                "color": simple_style["fillColor"],
                "opacity": simple_style.get("fillOpacity", 1.0),
            }
        )
    if simple_style.get("strokeColor") or simple_style.get("strokeWidth"):
        dash = None
        if simple_style.get("dashArray"):
            dash = {"array": simple_style["dashArray"]}
        layers.append(
            {
                "type": "stroke",
                "color": simple_style.get("strokeColor", "#000000"),
                "width": simple_style.get("strokeWidth", 1.0),
                "opacity": simple_style.get("strokeOpacity", 1.0),
                "dash": dash,
            }
        )
    return {"symbolLayers": layers}


@dataclass
class LayerEntry:
    id: str
    name: str
    file: str
    format: str = "geojson"
    geometry_type: str = "unknown"
    pmtiles_file: Optional[str] = None
    ui_popup: Optional[Dict] = None
    ui_legend_label: Optional[str] = None
    wmts: Optional[Dict] = None
    mask: Optional[Dict] = None

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "id": self.id,
            "name": self.name,
            "file": self.file if self.wmts is None else "",
            "format": self.format,
            "geometryType": self.geometry_type,
        }
        if self.pmtiles_file:
            d["pmtilesFile"] = self.pmtiles_file
        ui = {}
        if self.ui_popup:
            ui["popup"] = self.ui_popup
        if self.ui_legend_label:
            ui["legendLabel"] = self.ui_legend_label
        if ui:
            d["ui"] = ui
        if self.wmts is not None:
            d["wmts"] = self.wmts
        if self.mask is not None:
            d["mask"] = self.mask
        return d

    @classmethod
    def create_image_layer(
        cls, layer_id: str, name: str, filename: str
    ) -> "LayerEntry":
        """Create a LayerEntry for an image file"""
        return cls(
            id=layer_id, name=name, file=filename, format="image", geometry_type="image"
        )

    @classmethod
    def create_wmts_layer(
        cls,
        layer_id: str,
        name: str,
        wmts_config: Dict[str, Any],
        mask: Optional[Dict] = None,
    ) -> "LayerEntry":
        """Create a LayerEntry for a WMTS layer (from .wmts.json file)."""
        return cls(
            id=layer_id,
            name=name,
            file="",
            format="wmts",
            geometry_type="raster",
            wmts=wmts_config,
            mask=mask,
        )


@dataclass
class PackManifest:
    id: str
    name: str
    layers: List[LayerEntry] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "layers": [l.to_dict() for l in self.layers],
        }


@dataclass
class StyleConfig:
    geometry_type: str
    renderer: str = "simple"
    default_style: Dict = field(default_factory=dict)
    full_symbol_layers: List[Dict] = field(default_factory=list)
    labels: Optional[Dict] = None
    scale_range: Optional[Dict] = None
    unique_values: Optional[Dict] = None
    # Styling complexity and advanced symbol IR (optional, used for advanced rendering paths)
    complexity: str = "simple"  # "simple" | "advanced"
    advanced_symbol: Optional[Dict] = None

    def to_dict(self) -> Dict[str, Any]:
        # Single source of truth for drawing: defaultSymbol only (no defaultStyle/advancedSymbol).
        d = {
            "type": self.geometry_type,
            "renderer": self.renderer,
            "labels": self.labels,
            "scaleRange": self.scale_range,
            "defaultSymbol": self.advanced_symbol
            or _simple_style_to_symbol_ir(self.default_style),
        }
        if self.unique_values:
            classes = self.unique_values.get("classes", [])
            classes_out = []
            for cls in classes:
                # Per-class: only value, label, symbol (no style/advancedSymbol).
                symbol = cls.get("advancedSymbol") or _simple_style_to_symbol_ir(
                    cls.get("style", {})
                )
                classes_out.append(
                    {
                        "value": cls.get("value"),
                        "label": cls.get("label", ""),
                        "symbol": symbol,
                    }
                )
            d["uniqueValues"] = {
                **{k: v for k, v in self.unique_values.items() if k != "classes"},
                "classes": classes_out,
            }
        # complexity omitted: one path makes it redundant; symbol types are in defaultSymbol
        return d
