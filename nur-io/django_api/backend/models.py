from django.db import models
import os
from django.utils import timezone


def indicator_media_path(instance, filename):
    """
    Organize uploaded media (images, videos, HTML, etc.) by category/indicator name/state
    Supports UGC separation via is_user_generated flag
    """
    # Get indicator name and category
    indicator_name = instance.indicatorData.indicator.name.replace(" ", "_").lower()
    category = instance.indicatorData.indicator.category
    is_ugc = instance.indicatorData.indicator.is_user_generated

    # Try to get state identifier from state_values
    try:
        state_values = instance.indicatorData.state.state_values or {}
        state_year = state_values.get("year", "")
        scenario = state_values.get("scenario", "")
        state_id = (
            f"{state_year}_{scenario}".strip("_")
            if (state_year or scenario)
            else "default"
        )
    except (AttributeError, KeyError, TypeError):
        state_id = "default"

    # Get file extension
    ext = os.path.splitext(filename)[1].lower()

    # Separate folder for UGC content
    prefix = "ugc_indicators" if is_ugc else "indicators"
    return f"{prefix}/{category}/{indicator_name}_{state_id}{ext}"


class Table(models.Model):
    """
    Higher-level container for organizing indicators by data source/table.
    Examples: 'otef', 'idistrict'
    """

    id = models.AutoField(primary_key=True)
    name = models.CharField(
        max_length=100,
        unique=True,
        help_text="Internal name (e.g., 'otef', 'idistrict')",
    )
    display_name = models.CharField(
        max_length=255, help_text="Human-readable display name"
    )
    description = models.TextField(
        blank=True, null=True, help_text="Description of the table/data source"
    )
    is_active = models.BooleanField(
        default=True, help_text="Whether this table is currently active"
    )
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "Table"
        verbose_name_plural = "Tables"

    def __str__(self):
        return self.display_name or self.name


class Indicator(models.Model):
    id = models.AutoField(primary_key=True)
    table = models.ForeignKey(
        Table,
        on_delete=models.CASCADE,
        related_name="indicators",
        null=True,
        blank=True,
        help_text="The table/data source this indicator belongs to",
    )
    indicator_id = models.IntegerField()
    name = models.CharField(max_length=100)
    has_states = models.BooleanField(default=False)
    description = models.TextField(blank=True, null=True)
    category = models.CharField(
        max_length=50,
        choices=[
            ("mobility", "Mobility"),
            ("climate", "Climate"),
        ],
        default="mobility",
    )
    is_user_generated = models.BooleanField(
        default=False,
        help_text="Whether this indicator was created by a user (vs preloaded system data)",
    )

    class Meta:
        unique_together = [["table", "indicator_id"]]
        indexes = [
            models.Index(fields=["table", "indicator_id"]),
        ]

    def __str__(self):
        return f"{self.table.name}/{self.name}"


class State(models.Model):
    id = models.AutoField(primary_key=True)
    state_values = models.JSONField(
        default=dict, blank=True, null=True
    )  # Stores state values in JSON format
    scenario_type = models.CharField(
        max_length=50,
        choices=[("utci", "UTCI Map"), ("plan", "Plan Map"), ("general", "General")],
        default="general",
        help_text="Type of visualization/scenario for climate indicators",
    )
    scenario_name = models.CharField(
        max_length=100,
        blank=True,
        null=True,
        help_text="Human-readable name for the scenario",
    )
    is_user_generated = models.BooleanField(
        default=False,
        help_text="Whether this state was created by a user (vs preloaded system data)",
    )

    class Meta:
        indexes = [
            models.Index(
                fields=["scenario_type", "scenario_name"], name="state_scenario_idx"
            ),
        ]

    def __str__(self):
        if self.scenario_name:
            return f"{self.scenario_name} ({self.scenario_type})"
        return f"State with values {self.state_values}"


class IndicatorData(models.Model):
    id = models.AutoField(primary_key=True)
    indicator = models.ForeignKey(
        Indicator, on_delete=models.CASCADE, related_name="data"
    )
    state = models.ForeignKey(State, on_delete=models.CASCADE, related_name="data")

    def __str__(self):
        return f"Data {self.id}"


class IndicatorImage(models.Model):
    """
    Stores media files (images, videos, HTML maps, etc.) for indicator data.
    Note: Model name kept as IndicatorImage for backward compatibility,
    but now supports all media types via FileField and media_type field.
    """

    MEDIA_TYPE_CHOICES = [
        ("image", "Image"),
        ("video", "Video"),
        ("html_map", "HTML Map"),
        ("deckgl_layer", "Deck.GL Layer"),
    ]

    id = models.AutoField(primary_key=True)
    indicatorData = models.ForeignKey(
        IndicatorData, on_delete=models.CASCADE, related_name="images"
    )
    image = models.FileField(
        upload_to=indicator_media_path
    )  # Changed from ImageField to FileField
    media_type = models.CharField(
        max_length=20,
        choices=MEDIA_TYPE_CHOICES,
        default="image",
        help_text="Type of media file (image, video, html_map, deckgl_layer)",
    )
    uploaded_at = models.DateTimeField(default=timezone.now)

    def __str__(self):
        indicator_name = self.indicatorData.indicator.name
        return f"{self.media_type.title()} for {indicator_name}"

    class Meta:
        ordering = ["-uploaded_at"]


class DashboardFeedState(models.Model):
    id = models.AutoField(primary_key=True)
    state = models.ForeignKey(
        State, on_delete=models.CASCADE, related_name="dashboard_feed"
    )
    data = models.JSONField(default=dict)
    dashboard_type = models.CharField(
        max_length=50,
        choices=[
            ("mobility", "Mobility"),
            ("climate", "Climate"),
        ],
        default="mobility",
    )

    def __str__(self):
        return f"DashboardFeedState {self.id}"


class LayerConfig(models.Model):
    id = models.AutoField(primary_key=True)
    indicatorData = models.ForeignKey(
        IndicatorData, on_delete=models.CASCADE, related_name="layer_config"
    )
    layer_config = models.JSONField(default=dict)

    def __str__(self):
        return f"LayerConfig {self.id}"


class GISLayer(models.Model):
    """
    Stores GIS layer definitions (GeoJSON, vector tiles, etc.)
    """

    id = models.AutoField(primary_key=True)
    table = models.ForeignKey(
        Table, on_delete=models.CASCADE, related_name="gis_layers"
    )
    name = models.CharField(max_length=100)
    display_name = models.CharField(max_length=255)
    layer_type = models.CharField(
        max_length=50,
        choices=[
            ("geojson", "GeoJSON"),
            ("vector_tiles", "Vector Tiles"),
            ("raster", "Raster"),
        ],
        default="geojson",
    )
    data = models.JSONField(default=dict)
    file_path = models.CharField(max_length=500, blank=True, null=True)
    style_config = models.JSONField(default=dict)
    is_active = models.BooleanField(default=True)
    order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [["table", "name"]]
        ordering = ["order", "name"]

    def __str__(self):
        return f"{self.table.name}/{self.display_name}"


class OTEFModelConfig(models.Model):
    """
    Stores OTEF physical model configuration (bounds, calibration, etc.)
    """

    id = models.AutoField(primary_key=True)
    table = models.OneToOneField(
        Table, on_delete=models.CASCADE, related_name="otef_config"
    )
    model_bounds = models.JSONField(default=dict)
    model_image = models.FileField(upload_to="otef/models/", blank=True, null=True)
    model_image_transparent = models.FileField(
        upload_to="otef/models/", blank=True, null=True
    )
    calibration_data = models.JSONField(default=dict)
    coordinate_system = models.CharField(max_length=50, default="EPSG:2039")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"OTEF Config for {self.table.name}"


class OTEFViewportState(models.Model):
    """
    Stores complete OTEF interactive state - single source of truth.
    All controllers read from and write to this model.
    """

    # Default layer visibility states
    DEFAULT_LAYERS = {
        "roads": True,
        "parcels": False,
        "model": True,  # Legacy model overlay enabled by default
        "majorRoads": False,
        "smallRoads": False,
    }

    # Default viewport (EPSG:2039 ITM coordinates for Otef area)
    DEFAULT_VIEWPORT = {
        "bbox": [165000, 595000, 175000, 605000],  # [minX, minY, maxX, maxY]
        "corners": None,
        "zoom": 15,
    }

    id = models.AutoField(primary_key=True)
    table = models.OneToOneField(
        Table, on_delete=models.CASCADE, related_name="otef_viewport"
    )

    # Viewport state (written by GIS map, or calculated server-side)
    viewport = models.JSONField(default=dict)

    # Layer visibility (written by remote controller)
    layers = models.JSONField(default=dict)

    # Animation state (written by remote controller)
    animations = models.JSONField(default=dict)

    # Optional hard-wall navigation bounds (polygon in EPSG:2039)
    # Stored as an ordered list of {"x": number, "y": number} vertices
    bounds_polygon = models.JSONField(default=list, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"State for {self.table.name}"

    def get_viewport_with_defaults(self):
        """Return viewport with defaults for missing fields"""
        viewport = self.viewport or {}
        return {
            "bbox": viewport.get("bbox", self.DEFAULT_VIEWPORT["bbox"]),
            "corners": viewport.get("corners", self.DEFAULT_VIEWPORT["corners"]),
            "zoom": viewport.get("zoom", self.DEFAULT_VIEWPORT["zoom"]),
        }

    def get_layers_with_defaults(self):
        """Return layers with defaults for missing fields"""
        layers = self.layers or {}
        return {**self.DEFAULT_LAYERS, **layers}

    def get_animations_with_defaults(self):
        """Return animations with defaults"""
        return self.animations or {"parcels": False}

    def get_bounds_polygon(self):
        """
        Return bounds polygon as a list of vertices.
        Always returns a list (possibly empty).
        """
        polygon = self.bounds_polygon or []
        # Ensure it's a list to keep JSONField usages consistent
        if isinstance(polygon, list):
            return polygon
        return []

    def _extract_coord_value(self, coord):
        """
        Extract x, y from corner coordinate, handling multiple formats:
        - Dict: {'x': val, 'y': val}
        - List: [x, y]
        """
        if isinstance(coord, dict):
            return coord.get("x", 0), coord.get("y", 0)
        elif isinstance(coord, (list, tuple)) and len(coord) >= 2:
            return coord[0], coord[1]
        return 0, 0

    def apply_pan_command(self, direction, delta=0.15):
        """
        Apply a pan command server-side without requiring GIS map.
        Modifies bbox based on direction and delta percentage.

        Args:
            direction: 'north', 'south', 'east', 'west', etc.
            delta: Percentage of viewport size to pan (0.0-1.0)

        Returns:
            Updated viewport dict
        """
        viewport = self.get_viewport_with_defaults()
        bbox = viewport["bbox"]

        if not bbox or len(bbox) != 4:
            return viewport

        min_x, min_y, max_x, max_y = bbox
        width = max_x - min_x
        height = max_y - min_y

        dx, dy = 0, 0

        # Handle 8-way directions
        if "north" in direction:
            dy = height * delta
        if "south" in direction:
            dy = -height * delta
        if "east" in direction:
            dx = width * delta
        if "west" in direction:
            dx = -width * delta

        new_bbox = [min_x + dx, min_y + dy, max_x + dx, max_y + dy]

        # Generate corners in format projector expects: {sw: {x, y}, se: {x, y}, nw: {x, y}, ne: {x, y}}
        viewport["corners"] = {
            "sw": {"x": new_bbox[0], "y": new_bbox[1]},
            "se": {"x": new_bbox[2], "y": new_bbox[1]},
            "nw": {"x": new_bbox[0], "y": new_bbox[3]},
            "ne": {"x": new_bbox[2], "y": new_bbox[3]},
        }

        viewport["bbox"] = new_bbox
        return viewport

    def apply_zoom_command(self, new_zoom):
        """
        Apply a zoom command server-side without requiring GIS map.
        Scales bbox around center based on zoom level change.

        Args:
            new_zoom: Target zoom level (10-19)

        Returns:
            Updated viewport dict
        """
        viewport = self.get_viewport_with_defaults()
        bbox = viewport["bbox"]
        current_zoom = viewport.get("zoom", 15)

        if not bbox or len(bbox) != 4:
            viewport["zoom"] = new_zoom
            return viewport

        min_x, min_y, max_x, max_y = bbox
        center_x = (min_x + max_x) / 2
        center_y = (min_y + max_y) / 2

        # Each zoom level doubles/halves the scale
        zoom_diff = new_zoom - current_zoom
        scale_factor = 2 ** (-zoom_diff)  # Zoom in = smaller bbox

        half_width = (max_x - min_x) / 2 * scale_factor
        half_height = (max_y - min_y) / 2 * scale_factor

        new_bbox = [
            center_x - half_width,
            center_y - half_height,
            center_x + half_width,
            center_y + half_height,
        ]

        viewport["bbox"] = new_bbox
        viewport["zoom"] = new_zoom

        # Generate corners in format projector expects: {sw: {x, y}, se: {x, y}, nw: {x, y}, ne: {x, y}}
        viewport["corners"] = {
            "sw": {"x": new_bbox[0], "y": new_bbox[1]},
            "se": {"x": new_bbox[2], "y": new_bbox[1]},
            "nw": {"x": new_bbox[0], "y": new_bbox[3]},
            "ne": {"x": new_bbox[2], "y": new_bbox[3]},
        }

        return viewport


class LayerGroup(models.Model):
    """
    Represents a group of layers (e.g., "map_3_future", "_legacy").
    Groups can be toggled on/off as a unit.
    """

    id = models.AutoField(primary_key=True)
    table = models.ForeignKey(
        Table, on_delete=models.CASCADE, related_name="layer_groups"
    )
    group_id = models.CharField(
        max_length=100, help_text="Layer pack ID (e.g., 'map_3_future', '_legacy')"
    )
    enabled = models.BooleanField(
        default=False, help_text="Whether the entire group is enabled"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [["table", "group_id"]]
        indexes = [
            models.Index(fields=["table", "group_id"]),
        ]
        ordering = ["group_id"]

    def __str__(self):
        return f"{self.table.name}/{self.group_id}"


class LayerState(models.Model):
    """
    Represents the visibility state of an individual layer within a group.
    Layer ID format: "{group_id}.{layer_id}" (e.g., "map_3_future.mimushim")
    """

    id = models.AutoField(primary_key=True)
    table = models.ForeignKey(
        Table, on_delete=models.CASCADE, related_name="layer_states"
    )
    layer_id = models.CharField(
        max_length=200, help_text="Full layer ID: group_id.layer_id"
    )
    enabled = models.BooleanField(
        default=False, help_text="Whether this specific layer is visible"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [["table", "layer_id"]]
        indexes = [
            models.Index(fields=["table", "layer_id"]),
        ]
        ordering = ["layer_id"]

    def __str__(self):
        return f"{self.table.name}/{self.layer_id}"
