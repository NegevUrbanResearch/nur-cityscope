from django.core.management.base import BaseCommand
from backend.models import (
    Indicator,
    State,
    IndicatorData,
    IndicatorGeojson,
    LayerConfig,
    DashboardFeedState,
    MapType,
    IndicatorImage,
)
import random
from datetime import datetime
import os
import json
import pydeck as pdk
import pandas as pd
from PIL import Image
import numpy as np
from django.core.files.base import ContentFile
import io
import matplotlib.pyplot as plt
from matplotlib import cm
import shutil
from pathlib import Path

"""
Dashboard Data Structure Documentation:

1. Mobility Dashboard:
   - Basic Metrics:
     - total_population: Total population count
     - public_transport_coverage: Percentage of area covered by public transport
     - average_commute_time: Average commute time in minutes
   - Visualizations:
     - radar: Mobility-related metrics (walkability, public transport, bike lanes)
     - trafficLight: Key mobility indicators with status
     - dataTable: Detailed mobility metrics by district

2. Climate Dashboard:
   - Basic Metrics:
     - green_space_percentage: Percentage of green space
     - air_quality_index: Current air quality index
     - carbon_emissions: Total carbon emissions in tons
   - Visualizations:
     - radar: Climate-related metrics (air quality, emissions, green space)
     - stackedBar: Environmental indicators over time
     - horizontalStackedBar: Climate impact by sector

3. Land Use Dashboard:
   - Basic Metrics:
     - average_building_height: Average building height in meters
     - mixed_use_ratio: Ratio of mixed-use buildings
     - population_density: Population per square kilometer
   - Visualizations:
     - radar: Land use metrics (density, mixed-use, building height)
     - table: Land use distribution by district
     - stackedBar: Building types distribution

Each dashboard type should maintain consistent data structures while focusing on relevant metrics.
"""


class Command(BaseCommand):
    help = "Creates sample data for the nur-CityScope application"

    # ===== Real data loader helpers =====
    def _get_public_dir(self):
        """Return absolute path to django_api/public directory."""
        from django.conf import settings

        return os.path.join(settings.BASE_DIR, "public")

    def _scenario_key_from_state(self, state_values):
        """Map state scenario/year to a directory key used under public/processed/.
        present -> current scenario (2023), projected -> future (2040)
        """
        scenario = (state_values or {}).get("scenario", "") or ""
        scenario = scenario.lower().strip()
        if scenario in ["present", "current"]:
            return "present"
        if scenario in ["future", "projected"]:
            return "projected"
        # Default to present
        return "present"

    def _ensure_media_file(self, src_path: str, dst_rel_path: str) -> str:
        """Copy src_path into MEDIA_ROOT at dst_rel_path if needed and return the relative path.
        Asserts file existence and sets safe permissions.
        """
        from django.conf import settings

        assert os.path.isfile(src_path), f"Real asset not found: {src_path}"
        dst_abs_path = os.path.join(settings.MEDIA_ROOT, dst_rel_path)
        os.makedirs(os.path.dirname(dst_abs_path), exist_ok=True)
        shutil.copyfile(src_path, dst_abs_path)
        os.chmod(dst_abs_path, 0o644)
        return dst_rel_path

    def _try_load_real_assets(self, indicator, state):
        """Try to load real assets from public/ for given indicator/state.
        Returns dict with optional keys: image_rel_path, map_rel_path, geojson_dict.
        """
        results = {}
        public_dir = self._get_public_dir()
        category = (indicator.category or "").strip().lower() or "mobility"
        scenario_key = self._scenario_key_from_state(getattr(state, "state_values", {}))
        base = Path(public_dir) / "processed" / category / scenario_key

        # Image
        image_dir = base / "image"
        if image_dir.exists() and image_dir.is_dir():
            # Pick first common image extension
            candidates = []
            for ext in ["*.png", "*.jpg", "*.jpeg", "*.gif", "*.svg"]:
                candidates.extend(list(image_dir.glob(ext)))
            if candidates:
                src = str(sorted(candidates)[0])
                indicator_name = indicator.name.replace(" ", "_").lower()
                state_year = (state.state_values or {}).get("year", 2023)
                dst_rel = f"indicators/{category}/{indicator_name}_{state_year}{Path(src).suffix.lower()}"
                results["image_rel_path"] = self._ensure_media_file(src, dst_rel)

        # Map HTML
        map_dir = base / "map"
        if map_dir.exists() and map_dir.is_dir():
            maps = list(map_dir.glob("*.html"))
            if maps:
                src = str(sorted(maps)[0])
                indicator_name = (
                    indicator.name.replace(" ", "").replace(" ", "_").lower()
                )
                state_year = (state.state_values or {}).get("year", 2023)
                dst_rel = f"maps/{indicator_name}_{state_year}.html"
                results["map_rel_path"] = self._ensure_media_file(src, dst_rel)

        # GeoJSON (optional)
        geojson_dir = base / "geojson"
        if geojson_dir.exists() and geojson_dir.is_dir():
            gj_files = list(geojson_dir.glob("*.json"))
            if gj_files:
                try:
                    with open(gj_files[0]) as f:
                        results["geojson_dict"] = json.load(f)
                except Exception as e:
                    self.stdout.write(
                        self.style.WARNING(f"Failed to load real geojson: {e}")
                    )

        return results

    # Mapping is optional and not generated; only real files are used if present

    def generate_dashboard_data(self, state, dashboard_type):
        """Generate dashboard-specific data based on type and state"""
        year_factor = (
            state.state_values["year"] - 2023
        ) / 17  # Normalized factor (0 to 1)

        # Dashboard-specific metrics and categories
        dashboard_configs = {
            "mobility": {
                "metrics": {
                    "total_population": int(800000 * (1 + year_factor * 0.4)),
                    "public_transport_coverage": float(
                        f"{min(100, 40 + year_factor * 30):.2f}"
                    ),
                    "average_commute_time": float(
                        f"{30 * (1 - year_factor * 0.2):.2f}"
                    ),
                    "bike_lane_coverage": float(
                        f"{min(100, 35 + year_factor * 35):.2f}"
                    ),
                },
                "radar_categories": [
                    "Walkability",
                    "Public Transport",
                    "Bike Lanes",
                    "Traffic Flow",
                    "Accessibility",
                    "Pedestrian Safety",
                    "Transit Frequency",
                    "Last Mile",
                    "Mobility Hubs",
                    "Car Sharing",
                    "Bike Sharing",
                    "Parking",
                    "Mobility Score",
                ],
                "stacked_bar_categories": [
                    "Public Transport",
                    "Active Transport",
                    "Private Vehicles",
                ],
                "horizontal_bar_categories": [
                    "Accessibility",
                    "Connectivity",
                    "Coverage",
                ],
                "traffic_light_categories": [
                    "Public Transport",
                    "Bike Infrastructure",
                    "Pedestrian Safety",
                ],
                "data_table_categories": ["Public Transport", "Active Transport"],
            },
            "climate": {
                "metrics": {
                    "total_population": int(800000 * (1 + year_factor * 0.4)),
                    "air_quality_index": float(
                        f"{min(100, 60 + year_factor * 20):.2f}"
                    ),
                    "carbon_emissions": int(1000000 * (1 - year_factor * 0.3)),
                    "renewable_energy_percentage": float(
                        f"{min(100, 30 + year_factor * 40):.2f}"
                    ),
                    "green_space_percentage": float(
                        f"{min(100, 25 + year_factor * 30):.2f}"
                    ),
                },
                "radar_categories": [
                    "Air Quality",
                    "Green Space",
                    "Carbon Emissions",
                    "Energy Efficiency",
                    "Waste Management",
                    "Water Quality",
                    "Biodiversity",
                    "Urban Heat",
                    "Storm Water",
                    "Renewable Energy",
                    "Energy Consumption",
                    "Waste Reduction",
                    "Climate Score",
                ],
                "stacked_bar_categories": [
                    "Renewable Energy",
                    "Green Space",
                    "Waste Reduction",
                ],
                "horizontal_bar_categories": ["Transport", "Buildings", "Industry"],
                "traffic_light_categories": [
                    "Air Quality",
                    "Energy Efficiency",
                    "Waste Management",
                ],
                "data_table_categories": ["Energy", "Waste"],
            },
            "land_use": {
                "metrics": {
                    "total_population": int(800000 * (1 + year_factor * 0.4)),
                    "mixed_use_ratio": float(f"{min(100, 30 + year_factor * 40):.2f}"),
                    "population_density": int(5000 * (1 + year_factor * 0.5)),
                    "public_space_percentage": float(
                        f"{min(100, 25 + year_factor * 35):.2f}"
                    ),
                    "average_building_height": float(
                        f"{15 * (1 + year_factor * 0.5):.2f}"
                    ),
                },
                "radar_categories": [
                    "Density",
                    "Mixed-Use",
                    "Building Height",
                    "Land Efficiency",
                    "Public Space",
                    "Housing Diversity",
                    "Commercial Mix",
                    "Cultural Space",
                    "Green Space",
                    "Accessibility",
                    "Connectivity",
                    "Urban Form",
                    "Land Use Score",
                ],
                "stacked_bar_categories": ["Residential", "Commercial", "Mixed-Use"],
                "horizontal_bar_categories": ["Density", "Diversity", "Accessibility"],
                "traffic_light_categories": [
                    "Mixed-Use",
                    "Public Space",
                    "Housing Diversity",
                ],
                "data_table_categories": ["Land Use", "Building Types"],
            },
        }

        config = dashboard_configs[dashboard_type]

        # Generate radar chart data
        radar_data = {
            "categories": config["radar_categories"],
            "valuesSet1": [
                min(100, 45 + year_factor * 25 + random.uniform(-5, 5))
                for _ in range(len(config["radar_categories"]))
            ],
            "valuesSet2": [
                min(100, 60 + random.uniform(-10, 10))
                for _ in range(len(config["radar_categories"]))
            ],
        }

        # Generate horizontal stacked bar data
        horizontal_stacked_bar = {
            "bars": [
                {
                    "name": category,
                    "values": [
                        min(100, 40 + year_factor * 20 + random.uniform(-5, 5)),
                        min(100, 30 + year_factor * 15 + random.uniform(-5, 5)),
                        min(100, 20 + year_factor * 10 + random.uniform(-5, 5)),
                    ],
                }
                for category in config["horizontal_bar_categories"]
            ]
        }

        # Generate stacked bar data
        stacked_bar = {
            "bars": [
                {
                    "name": category,
                    "values": [
                        min(100, 40 + year_factor * 20 + random.uniform(-5, 5)),
                        100 - min(100, 40 + year_factor * 20 + random.uniform(-5, 5)),
                    ],
                }
                for category in config["stacked_bar_categories"]
            ]
        }

        # Generate data table
        data_table = {
            "categories": [
                {
                    "name": category,
                    "indicators": {
                        "current": min(
                            100, 70 + year_factor * 15 + random.uniform(-5, 5)
                        ),
                        "target": min(
                            100, 60 + year_factor * 20 + random.uniform(-5, 5)
                        ),
                    },
                }
                for category in config["data_table_categories"]
            ]
        }

        # Generate traffic light data
        traffic_light = [
            {
                "name": category,
                "value": min(100, 70 + year_factor * 15 + random.uniform(-5, 5)),
            }
            for category in config["traffic_light_categories"]
        ]

        # Combine all components
        dashboard_data = {
            **config["metrics"],
            "radar": radar_data,
            "horizontalStackedBar": horizontal_stacked_bar,
            "stackedBar": stacked_bar,
            "dataTable": data_table,
            "trafficLight": traffic_light,
        }

        return dashboard_data

    def generate_pydeck_map(self, indicator_name, state_year, output_dir="media/maps"):
        """Generate a sample map visualization using PyDeck"""
        # Create the directory if it doesn't exist
        os.makedirs(output_dir, exist_ok=True)

        # Generate sample data for BioBio region
        # Center around Concepción, Chile
        center_lat, center_lon = -36.8274, -73.0498

        # Create grid of points
        num_points = 40
        points = []
        for i in range(num_points):
            lat = center_lat + random.uniform(-0.15, 0.15)
            lon = center_lon + random.uniform(-0.15, 0.15)

            # Value based on indicator type
            if "Population" in indicator_name:
                value = random.uniform(500, 5000)
            elif "Green Space" in indicator_name:
                value = random.uniform(10, 40)
            elif "Building Height" in indicator_name:
                value = random.uniform(5, 50)
            elif "Mobility" in indicator_name:
                value = random.uniform(0, 100)
            elif "Climate" in indicator_name:
                value = random.uniform(0, 100)
            elif "Land Use" in indicator_name:
                value = random.uniform(0, 100)
            else:
                value = random.uniform(0, 100)

            # Increase values for future projections
            year_factor = (state_year - 2023) / 17
            value = value * (1 + year_factor * 0.2)

            points.append(
                {
                    "lat": lat,
                    "lng": lon,
                    "value": value,
                    "radius": value / 50,  # Scale radius according to value
                }
            )

        # Convert to DataFrame for PyDeck
        df = pd.DataFrame(points)

        # Create the PyDeck visualization
        layer = pdk.Layer(
            "ScatterplotLayer",
            df,
            get_position=["lng", "lat"],
            get_radius="radius",
            get_fill_color=[
                "max(0, 255 - value * 2.55)",
                "min(255, value * 2.55)",
                "100",
                180,
            ],
            pickable=True,
            opacity=0.8,
            stroked=True,
            filled=True,
        )

        # Set the view state
        view_state = pdk.ViewState(
            latitude=center_lat, longitude=center_lon, zoom=10, pitch=0
        )

        # Create the deck
        deck = pdk.Deck(
            layers=[layer],
            initial_view_state=view_state,
            tooltip={"text": "{value}"},
            map_style="mapbox://styles/mapbox/dark-v10",
        )

        # Generate HTML file name
        clean_name = indicator_name.replace(" ", "").replace(" ", "_").lower()
        html_path = f"{output_dir}/{clean_name}_{state_year}.html"

        # Save as HTML
        deck.to_html(html_path)
        self.stdout.write(self.style.SUCCESS(f"Created map visualization: {html_path}"))

        return html_path

    def generate_synthetic_image(
        self, indicator_name, state_year, output_dir="media/indicators"
    ):
        """Generate a synthetic visualization image based on indicator type and state"""
        # Create main directory and subdirectories by indicator category
        category = "mobility"
        if "Climate" in indicator_name or "Green Space" in indicator_name:
            category = "climate"
        elif (
            "Land Use" in indicator_name
            or "Building Height" in indicator_name
            or "Population" in indicator_name
        ):
            category = "land_use"

        # Create subdirectory for this category if it doesn't exist
        category_dir = f"{output_dir}/{category}"
        os.makedirs(category_dir, exist_ok=True)

        # Generate file name
        clean_name = indicator_name.replace(" ", "").replace(" ", "_").lower()
        # Make sure the path includes indicators/ prefix
        img_path = f"indicators/{category}/{clean_name}_{state_year}.png"
        full_path = f"media/{img_path}"

        # Different visualization styles based on indicator type
        # Create a figure with a specific size
        plt.figure(figsize=(10, 8))

        # Year factor - affects visualization appearance based on future vs current
        year_factor = (state_year - 2023) / 17

        # Create different visualizations based on indicator type
        if "Mobility" in indicator_name:
            # Create a mobility heatmap
            x = np.linspace(-3, 3, 100)
            y = np.linspace(-3, 3, 100)
            X, Y = np.meshgrid(x, y)

            # Road network-like pattern, more developed in future
            Z = np.sin(X * 3) * np.cos(Y * 3) * np.exp(-(X**2 + Y**2) / 10)
            Z += year_factor * (np.sin(X * 5) * np.cos(Y * 5)) * 0.5

            plt.contourf(X, Y, Z, 20, cmap="viridis")
            plt.colorbar(label="Mobility Index")
            plt.title(f"Mobility Visualization - {state_year}")

        elif "Climate" in indicator_name or "Green Space" in indicator_name:
            # Create a climate visualization with more green in future projections
            x = np.linspace(-3, 3, 100)
            y = np.linspace(-3, 3, 100)
            X, Y = np.meshgrid(x, y)

            # Climate pattern, greener in future
            base = np.exp(-(X**2 + Y**2) / 5)
            future_enhancement = year_factor * 0.5
            Z = base + future_enhancement

            # More green in future projections
            colors = [(0.8, 0.2, 0.2), (0.8, 0.8, 0.2), (0.2, 0.8, 0.2)]
            if year_factor > 0.5:
                colors = [(0.5, 0.5, 0.2), (0.3, 0.7, 0.2), (0.1, 0.8, 0.1)]

            cmap = cm.colors.LinearSegmentedColormap.from_list(
                "custom_cmap", colors, N=256
            )
            plt.contourf(X, Y, Z, 20, cmap=cmap)
            plt.colorbar(label="Green Index")
            plt.title(f"Climate/Green Space - {state_year}")

        elif "Land Use" in indicator_name or "Building Height" in indicator_name:
            # Create a land use visualization with building blocks
            # Generate random building heights, taller in future
            np.random.seed(42)  # For reproducibility
            building_count = 100
            x = np.random.uniform(-5, 5, building_count)
            y = np.random.uniform(-5, 5, building_count)
            heights = np.random.uniform(1, 5, building_count) * (1 + year_factor * 2)

            # Make it look like a city grid
            plt.scatter(x, y, s=heights * 30, c=heights, cmap="plasma", alpha=0.7)
            plt.colorbar(label="Building Height")
            plt.title(f"Land Use / Building Height - {state_year}")

        elif "Population" in indicator_name:
            # Population density map
            x = np.linspace(-3, 3, 100)
            y = np.linspace(-3, 3, 100)
            X, Y = np.meshgrid(x, y)

            # Create population centers
            Z1 = np.exp(-((X - 1) ** 2 + (Y - 1) ** 2))
            Z2 = np.exp(-((X + 1) ** 2 + (Y + 1) ** 2) / 2)
            Z = (Z1 + Z2) * (1 + year_factor * 0.7)  # Higher density in future

            plt.contourf(X, Y, Z, 20, cmap="YlOrRd")
            plt.colorbar(label="Population Density")
            plt.title(f"Population Density - {state_year}")

        else:
            # Generic visualization for other indicator types
            x = np.linspace(-3, 3, 100)
            y = np.linspace(-3, 3, 100)
            X, Y = np.meshgrid(x, y)
            Z = np.sin(X) * np.cos(Y) * (1 + year_factor)

            plt.contourf(X, Y, Z, 20, cmap="viridis")
            plt.colorbar()
            plt.title(f"{indicator_name} - {state_year}")

        # Remove axes for cleaner visualization
        plt.axis("off")

        # Save the image
        plt.savefig(full_path, bbox_inches="tight", transparent=False)
        plt.close()

        self.stdout.write(self.style.SUCCESS(f"Created synthetic image: {full_path}"))
        return img_path

    def handle(self, *args, **options):
        # Clean up existing data before regenerating
        self.stdout.write(self.style.SUCCESS("Cleaning up existing data..."))
        Indicator.objects.all().delete()
        State.objects.all().delete()
        IndicatorData.objects.all().delete()
        IndicatorGeojson.objects.all().delete()
        IndicatorImage.objects.all().delete()
        LayerConfig.objects.all().delete()
        DashboardFeedState.objects.all().delete()
        MapType.objects.all().delete()

        # Ensure media directories exist with proper permissions
        from django.conf import settings

        media_root = settings.MEDIA_ROOT

        # Create main media directory
        os.makedirs(media_root, exist_ok=True)

        # Create subdirectories
        dirs_to_create = [
            os.path.join(media_root, "indicators"),
            os.path.join(media_root, "indicators/mobility"),
            os.path.join(media_root, "indicators/climate"),
            os.path.join(media_root, "indicators/land_use"),
            os.path.join(media_root, "maps"),
        ]

        for directory in dirs_to_create:
            os.makedirs(directory, exist_ok=True)
            # Set permissions to ensure nginx can read the files
            os.chmod(directory, 0o755)

        self.stdout.write(
            self.style.SUCCESS("Created necessary directories with proper permissions")
        )

        # Create sample map types
        map_types = []
        sample_map_types = [
            {
                "name": " Current State",
                "description": "Shows the current state of urban indicators",
                "is_active": True,
            },
            {
                "name": " Future Projection",
                "description": "Shows projected future state of urban indicators",
                "is_active": True,
            },
        ]

        for map_type_data in sample_map_types:
            map_type, created = MapType.objects.get_or_create(
                name=map_type_data["name"], defaults=map_type_data
            )
            map_types.append(map_type)
            if created:
                self.stdout.write(
                    self.style.SUCCESS(f"Created map type: {map_type.name}")
                )

        # Create sample indicators - limited to 3 as requested
        indicators = []
        sample_indicators = [
            {
                "indicator_id": 1,
                "name": " Mobility",
                "has_states": True,
                "description": "Transportation and mobility metrics including public transport coverage",
                "category": "mobility",
            },
            {
                "indicator_id": 2,
                "name": " Climate",
                "has_states": True,
                "description": "Environmental and climate metrics including green space",
                "category": "climate",
            },
            {
                "indicator_id": 3,
                "name": " Land Use",
                "has_states": True,
                "description": "Urban form and land use metrics including mixed-use development",
                "category": "land_use",
            },
        ]

        for indicator_data in sample_indicators:
            indicator, created = Indicator.objects.get_or_create(
                indicator_id=indicator_data["indicator_id"], defaults=indicator_data
            )
            indicators.append(indicator)
            if created:
                self.stdout.write(
                    self.style.SUCCESS(f"Created indicator: {indicator.name}")
                )

        # Create sample states - limited to 2 as requested
        states = []
        sample_states = [
            {"year": 2023, "scenario": "current", "label": "Current State"},
            {"year": 2040, "scenario": "projected", "label": "Future State"},
        ]

        for state_data in sample_states:
            state, created = State.objects.get_or_create(state_values=state_data)
            states.append(state)
            if created:
                self.stdout.write(
                    self.style.SUCCESS(f'Created state: {state_data["label"]}')
                )

        def generate_sample_geojson(indicator_name, state_year):
            """Generate sample GeoJSON data based on indicator type and state"""
            base_value = {
                "Mobility": random.uniform(0, 100),
                "Climate": random.uniform(0, 100),
                "Land Use": random.uniform(0, 100),
                "Population Density": random.uniform(1000, 5000),
                "Green Space Coverage": random.uniform(10, 40),
                "Building Height": random.uniform(10, 50),
            }.get(indicator_name.replace(" ", ""), 100)

            # Increase values for future projections
            year_factor = (state_year - 2023) / 17
            value = base_value * (1 + year_factor * 0.2)

            return {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {
                            "value": value,
                            "timestamp": datetime.now().isoformat(),
                            "indicator": indicator_name,
                            "year": state_year,
                        },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [
                                [
                                    [
                                        -73.5,
                                        -36.8,
                                    ],  # Sample coordinates for BioBio region
                                    [-73.4, -36.8],
                                    [-73.4, -36.7],
                                    [-73.5, -36.7],
                                    [-73.5, -36.8],
                                ]
                            ],
                        },
                    }
                ],
            }

        # Create sample indicator data and generate maps
        self.stdout.write(self.style.SUCCESS("Creating sample data..."))
        for indicator in indicators:
            for state in states:
                # Create or get indicator data
                data, created = IndicatorData.objects.get_or_create(
                    indicator=indicator, state=state
                )

                # Try to use real assets from public/ if available
                real_assets = {}
                try:
                    real_assets = self._try_load_real_assets(indicator, state)
                except AssertionError as e:
                    # Missing files will fall back to synthetic
                    self.stdout.write(self.style.WARNING(str(e)))

                # Map visualization: only use real map if available; never generate
                html_path = real_assets.get("map_rel_path")

                # Image: real if available else synthetic
                if real_assets.get("image_rel_path"):
                    img_path = real_assets["image_rel_path"]
                else:
                    img_path = self.generate_synthetic_image(
                        indicator.name, state.state_values["year"]
                    )

                # Create image record in database
                image_obj, created = IndicatorImage.objects.get_or_create(
                    indicatorData=data, defaults={"image": img_path}
                )
                if not created:
                    image_obj.image = img_path
                    image_obj.save()

                # GeoJSON: only store if real is available; never generate
                if real_assets.get("geojson_dict"):
                    IndicatorGeojson.objects.update_or_create(
                        indicatorData=data,
                        defaults={"geojson": real_assets["geojson_dict"]},
                    )

                # Add layer config
                LayerConfig.objects.update_or_create(
                    indicatorData=data,
                    defaults={
                        "layer_config": {
                            "opacity": 0.7,
                            "color": "#ff0000",
                            "fill": True,
                            **({"mapUrl": html_path} if html_path else {}),
                        }
                    },
                )
                self.stdout.write(
                    self.style.SUCCESS(
                        f'Created/updated data for {indicator.name} - {state.state_values["label"]}'
                    )
                )

        # Create dashboard feed states for each type and state
        for state in states:
            for dashboard_type in ["mobility", "climate", "land_use"]:
                # If a real dashboard file exists under public/processed/<type>/<scenario>/dashboard.json use it
                dashboard_data = None
                try:
                    public_dir = self._get_public_dir()
                    scenario_key = self._scenario_key_from_state(
                        getattr(state, "state_values", {})
                    )
                    candidate = (
                        Path(public_dir)
                        / "processed"
                        / dashboard_type
                        / scenario_key
                        / "dashboard.json"
                    )
                    if candidate.exists():
                        with open(candidate) as f:
                            dashboard_data = json.load(f)
                except Exception as e:
                    self.stdout.write(
                        self.style.WARNING(f"Failed loading real dashboard data: {e}")
                    )

                if dashboard_data is None:
                    dashboard_data = self.generate_dashboard_data(state, dashboard_type)

                # Create or update dashboard feed state
                feed_state, created = DashboardFeedState.objects.update_or_create(
                    state=state,
                    dashboard_type=dashboard_type,
                    defaults={"data": dashboard_data},
                )

                status = "Created" if created else "Updated"
                self.stdout.write(
                    self.style.SUCCESS(
                        f'{status} {dashboard_type} dashboard feed state for {state.state_values["label"]}'
                    )
                )

        self.stdout.write(self.style.SUCCESS("Sample data created successfully!"))
