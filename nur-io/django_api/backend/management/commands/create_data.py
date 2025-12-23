from django.core.management.base import BaseCommand
from backend.models import (
    Indicator,
    State,
    IndicatorData,
    IndicatorImage,
    DashboardFeedState,
    LayerConfig,
)
from django.conf import settings
import os
import json


class Command(BaseCommand):
    help = "Creates data structure and loads real data from public/processed/"

    def handle(self, *args, **options):
        self.stdout.write(
            self.style.SUCCESS("Setting up data structure from public/processed...")
        )

        # Get indicators and states
        mobility = Indicator.objects.filter(category="mobility").first()
        climate = Indicator.objects.filter(category="climate").first()

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

            # Load image
            image_path = self._find_mobility_image(scenario)
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
                    self.style.WARNING(f"    [WARN] No image found for {scenario}")
                )

            # Load HTML map if exists
            map_path = self._find_mobility_map(scenario)
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
        """Find mobility image/video in public/processed/mobility/{scenario}/image/"""
        base_path = os.path.join(
            settings.BASE_DIR, "public", "processed", "mobility", scenario, "image"
        )

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
        """Find mobility HTML map in public/processed/mobility/{scenario}/map/"""
        base_path = os.path.join(
            settings.BASE_DIR, "public", "processed", "mobility", scenario, "map"
        )

        if os.path.exists(base_path):
            for filename in os.listdir(base_path):
                if filename.lower().endswith(".html"):
                    return f"processed/mobility/{scenario}/map/{filename}"
        return None

    def _find_climate_image(self, scenario_name, scenario_type):
        """Find climate image in public/processed/climate/{type}/"""
        # Directory is now just 'utci' or 'plan' instead of 'utci-scenarios'
        base_path = os.path.join(
            settings.BASE_DIR, "public", "processed", "climate", scenario_type
        )

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
