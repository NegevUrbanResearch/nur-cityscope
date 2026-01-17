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
        state_id = f"{state_year}_{scenario}".strip("_") if (state_year or scenario) else "default"
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
    name = models.CharField(max_length=100, unique=True, help_text="Internal name (e.g., 'otef', 'idistrict')")
    display_name = models.CharField(max_length=255, help_text="Human-readable display name")
    description = models.TextField(blank=True, null=True, help_text="Description of the table/data source")
    is_active = models.BooleanField(default=True, help_text="Whether this table is currently active")
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
        help_text="The table/data source this indicator belongs to"
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
        help_text="Whether this indicator was created by a user (vs preloaded system data)"
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
        help_text="Whether this state was created by a user (vs preloaded system data)"
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
        ('image', 'Image'),
        ('video', 'Video'),
        ('html_map', 'HTML Map'),
        ('deckgl_layer', 'Deck.GL Layer'),
    ]

    id = models.AutoField(primary_key=True)
    indicatorData = models.ForeignKey(
        IndicatorData, on_delete=models.CASCADE, related_name="images"
    )
    image = models.FileField(upload_to=indicator_media_path)  # Changed from ImageField to FileField
    media_type = models.CharField(
        max_length=20,
        choices=MEDIA_TYPE_CHOICES,
        default='image',
        help_text="Type of media file (image, video, html_map, deckgl_layer)"
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
    table = models.ForeignKey(Table, on_delete=models.CASCADE, related_name="gis_layers")
    name = models.CharField(max_length=100)
    display_name = models.CharField(max_length=255)
    layer_type = models.CharField(
        max_length=50,
        choices=[
            ('geojson', 'GeoJSON'),
            ('vector_tiles', 'Vector Tiles'),
            ('raster', 'Raster'),
        ],
        default='geojson'
    )
    data = models.JSONField(default=dict)
    file_path = models.CharField(max_length=500, blank=True, null=True)
    style_config = models.JSONField(default=dict)
    is_active = models.BooleanField(default=True)
    order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        unique_together = [['table', 'name']]
        ordering = ['order', 'name']
    
    def __str__(self):
        return f"{self.table.name}/{self.display_name}"


class OTEFModelConfig(models.Model):
    """
    Stores OTEF physical model configuration (bounds, calibration, etc.)
    """
    id = models.AutoField(primary_key=True)
    table = models.OneToOneField(Table, on_delete=models.CASCADE, related_name="otef_config")
    model_bounds = models.JSONField(default=dict)
    model_image = models.FileField(upload_to='otef/models/', blank=True, null=True)
    model_image_transparent = models.FileField(upload_to='otef/models/', blank=True, null=True)
    calibration_data = models.JSONField(default=dict)
    coordinate_system = models.CharField(max_length=50, default='EPSG:2039')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"OTEF Config for {self.table.name}"


class OTEFViewportState(models.Model):
    """
    Stores current viewport state for OTEF table (for persistence across sessions)
    """
    id = models.AutoField(primary_key=True)
    table = models.OneToOneField(Table, on_delete=models.CASCADE, related_name="otef_viewport")
    viewport = models.JSONField(default=dict)
    layers = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"Viewport State for {self.table.name}"

