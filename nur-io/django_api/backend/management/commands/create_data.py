from django.core.management.base import BaseCommand
from backend.models import (
    Table,
    Indicator,
    State,
    IndicatorData,
    IndicatorImage,
    DashboardFeedState,
    LayerConfig,
)
from backend.climate_scenarios import CLIMATE_SCENARIO_MAPPING
from django.conf import settings
import os
import json


def _processed_root():
    """Root for processed data: prefer public_idistrict (Docker mount) then public."""
    base = getattr(settings, "BASE_DIR", os.getcwd())
    base = os.path.abspath(str(base))
    for sub in ("public_idistrict", "public"):
        path = os.path.join(base, sub, "processed")
        if os.path.isdir(path):
            return path
    return os.path.join(base, "public", "processed")


class Command(BaseCommand):
    help = "Creates data structure and loads real data from public/processed/"

    def _ensure_states_exist(self):
        """Create minimal State rows if none exist so IndicatorData/IndicatorImage can be linked."""
        if not State.objects.filter(scenario_type="general").exists():
            self.stdout.write(self.style.SUCCESS("[INFO] Seeding general (mobility) states..."))
            for scenario, label in [("present", "Present"), ("survey", "Survey")]:
                State.objects.create(
                    scenario_type="general",
                    state_values={"scenario": scenario, "label": label},
                )
                self.stdout.write(f"  Created state: {label}")

        if not State.objects.filter(scenario_type="utci").exists():
            self.stdout.write(self.style.SUCCESS("[INFO] Seeding climate states..."))
            for scenario_key in CLIMATE_SCENARIO_MAPPING:
                display_name = CLIMATE_SCENARIO_MAPPING[scenario_key]["display_name"]
                for stype in ("utci", "plan"):
                    State.objects.get_or_create(
                        scenario_type=stype,
                        scenario_name=scenario_key,
                        defaults={"state_values": {"scenario": scenario_key, "label": display_name}},
                    )
            self.stdout.write(f"  Created {len(CLIMATE_SCENARIO_MAPPING) * 2} climate states")

    def handle(self, *args, **options):
        self.stdout.write(
            self.style.SUCCESS("Setting up data structure from public/processed...")
        )

        # Get idistrict table (all existing data belongs to idistrict)
        idistrict_table = Table.objects.filter(name="idistrict").first()
        if not idistrict_table:
            self.stdout.write(
                self.style.ERROR("[ERROR] idistrict table not found! Run migrations first.")
            )
            return

        self._ensure_states_exist()

        # Get indicators from idistrict table
        mobility = Indicator.objects.filter(table=idistrict_table, category="mobility").first()
        climate = Indicator.objects.filter(table=idistrict_table, category="climate").first()

        general_states = State.objects.filter(scenario_type="general").order_by("id")
        climate_states = State.objects.filter(
            scenario_type__in=["utci", "plan"]
        ).order_by("scenario_name", "scenario_type")

        if not mobility or not climate:
            self.stdout.write(
                self.style.ERROR("[ERROR] Indicators not found! Run migrations first.")
            )
            return

        # Process Mobility data (Present/Survey states)
        self.stdout.write(self.style.SUCCESS("\n[INFO] Processing Mobility data..."))
        for state in general_states:
            scenario = state.state_values.get("scenario", "present")
            label = state.state_values.get("label", scenario)

            # Create IndicatorData link
            ind_data, created = IndicatorData.objects.get_or_create(
                indicator=mobility, state=state
            )
            if created:
                self.stdout.write(f"  [OK] Created IndicatorData: Mobility - {label}")

            image_path = self._find_mobility_image(scenario)
            map_path = self._find_mobility_map(scenario)
            if not image_path and map_path:
                image_path = map_path
            if image_path:
                img, img_created = IndicatorImage.objects.get_or_create(
                    indicatorData=ind_data, defaults={"image": image_path}
                )
                if img_created or img.image != image_path:
                    img.image = image_path
                    img.save()
                self.stdout.write(f"    [IMG] {image_path}")
            else:
                self.stdout.write(
                    self.style.WARNING(f"    [WARN] No image or map found for {scenario}")
                )

            if map_path:
                LayerConfig.objects.update_or_create(
                    indicatorData=ind_data,
                    defaults={
                        "layer_config": {
                            "mapUrl": f"/media/indicators/{map_path}",
                            "type": "html",
                        }
                    },
                )
                self.stdout.write(f"    [MAP] Map: {map_path}")

        # Process Climate data (scenario states)
        self.stdout.write(self.style.SUCCESS("\n[INFO] Processing Climate data..."))
        for state in climate_states:
            scenario_name = state.scenario_name
            scenario_type = state.scenario_type

            # Create IndicatorData link
            ind_data, created = IndicatorData.objects.get_or_create(
                indicator=climate, state=state
            )
            if created:
                self.stdout.write(
                    f"  [OK] Created IndicatorData: {scenario_name} ({scenario_type})"
                )

            # Load climate image
            image_path = self._find_climate_image(scenario_name, scenario_type)
            if image_path:
                img, img_created = IndicatorImage.objects.get_or_create(
                    indicatorData=ind_data, defaults={"image": image_path}
                )
                if img_created or img.image != image_path:
                    img.image = image_path
                    img.save()
                self.stdout.write(f"    [IMG] Image: {image_path}")
            else:
                self.stdout.write(
                    self.style.WARNING(
                        f"    [WARN] No image found for {scenario_name} ({scenario_type})"
                    )
                )

        self.stdout.write(
            self.style.SUCCESS(
                "\n[SUCCESS] Data structure created and real data loaded successfully!"
            )
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"   [INFO] {IndicatorData.objects.count()} IndicatorData entries"
            )
        )
        self.stdout.write(
            self.style.SUCCESS(f"   [INFO] {IndicatorImage.objects.count()} images linked")
        )

    def _find_mobility_image(self, scenario):
        """Find mobility image/video in processed/mobility/{scenario}/image/"""
        base_path = os.path.join(_processed_root(), "mobility", scenario, "image")

        if os.path.exists(base_path):
            # First try to find video files (preferred)
            for filename in os.listdir(base_path):
                if filename.lower().endswith((".mp4", ".webm", ".ogg")):
                    return f"processed/mobility/{scenario}/image/{filename}"

            # Fallback to image files
            for filename in os.listdir(base_path):
                if filename.lower().endswith((".png", ".jpg", ".jpeg", ".gif")):
                    return f"processed/mobility/{scenario}/image/{filename}"
        return None

    def _find_mobility_map(self, scenario):
        """Find mobility HTML map in processed/mobility/{scenario}/map/"""
        base_path = os.path.join(_processed_root(), "mobility", scenario, "map")

        if os.path.exists(base_path):
            for filename in os.listdir(base_path):
                if filename.lower().endswith(".html"):
                    return f"processed/mobility/{scenario}/map/{filename}"
        return None

    def _find_climate_image(self, scenario_name, scenario_type):
        """Find climate image in processed/climate/{type}/"""
        base_path = os.path.join(_processed_root(), "climate", scenario_type)

        if not os.path.exists(base_path):
            return None

        # Build search patterns for the scenario
        search_patterns = [
            scenario_name.replace("_", " "),  # e.g., "dense highrise"
            scenario_name.replace("_", "-"),  # e.g., "dense-highrise"
            scenario_name.replace("_", ""),  # e.g., "densehighrise"
        ]

        for filename in os.listdir(base_path):
            if not filename.lower().endswith((".png", ".jpg", ".jpeg", ".gif")):
                continue

            filename_lower = filename.lower()
            # Check if any pattern matches
            for pattern in search_patterns:
                if pattern.lower() in filename_lower:
                    return f"processed/climate/{scenario_type}/{filename}"

        return None
