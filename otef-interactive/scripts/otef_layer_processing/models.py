from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Any

@dataclass
class LayerEntry:
    id: str
    name: str
    file: str
    format: str = "geojson"
    geometry_type: str = "unknown"
    pmtiles_file: Optional[str] = None
    ui_popup: Optional[Dict] = None

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "id": self.id,
            "name": self.name,
            "file": self.file,
            "format": self.format,
            "geometryType": self.geometry_type,
        }
        if self.pmtiles_file:
            d["pmtilesFile"] = self.pmtiles_file
        if self.ui_popup:
            d["ui"] = {"popup": self.ui_popup}
        return d
    
    @classmethod
    def create_image_layer(cls, layer_id: str, name: str, filename: str) -> "LayerEntry":
        """Create a LayerEntry for an image file"""
        return cls(
            id=layer_id,
            name=name,
            file=filename,
            format="image",
            geometry_type="image"
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
            "layers": [l.to_dict() for l in self.layers]
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

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "type": self.geometry_type,
            "renderer": self.renderer,
            "defaultStyle": self.default_style,
            "fullSymbolLayers": self.full_symbol_layers,
            "labels": self.labels,
            "scaleRange": self.scale_range,
        }
        if self.unique_values:
            d["uniqueValues"] = self.unique_values
        return d
