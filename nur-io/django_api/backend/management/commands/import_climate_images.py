"""
Management command to import climate scenario images from public/processed to media directory.
This physically moves the images and updates the database references.
"""

from django.core.management.base import BaseCommand
from django.conf import settings
from backend.models import Indicator, State, IndicatorData, IndicatorImage
from backend.climate_scenarios import CLIMATE_SCENARIO_MAPPING
import os
import shutil
from pathlib import Path


class Command(BaseCommand):
    help = "Import climate scenario images from public/processed into media/indicators"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be done without actually doing it",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        # Define source and destination directories
        source_utci = (
            Path(settings.BASE_DIR) / "public/processed/climate/utci-scenarios"
        )
        source_plan = (
            Path(settings.BASE_DIR) / "public/processed/climate/plan-scenarios"
        )
        dest_base = Path(settings.MEDIA_ROOT) / "indicators/climate"
        dest_utci = dest_base / "utci-scenarios"
        dest_plan = dest_base / "plan-scenarios"

        # Ensure destination directories exist
        if not dry_run:
            dest_utci.mkdir(parents=True, exist_ok=True)
            dest_plan.mkdir(parents=True, exist_ok=True)
            self.stdout.write(f"✓ Created destination directories")
        else:
            self.stdout.write(f"[DRY RUN] Would create: {dest_utci}")
            self.stdout.write(f"[DRY RUN] Would create: {dest_plan}")

        # Get climate indicator
        climate_indicator = Indicator.objects.filter(category="climate").first()
        if not climate_indicator:
            self.stdout.write(self.style.ERROR("✗ Climate indicator not found"))
            return

        self.stdout.write(f"✓ Found climate indicator: {climate_indicator.name}")

        copied_count = 0
        updated_count = 0

        # Process each scenario
        for scenario_key, scenario_data in CLIMATE_SCENARIO_MAPPING.items():
            self.stdout.write(f"\nProcessing scenario: {scenario_data['display_name']}")

            # Process UTCI image
            utci_filename = scenario_data["utci_image"]
            source_utci_file = source_utci / utci_filename
            dest_utci_file = dest_utci / utci_filename

            if source_utci_file.exists():
                if not dry_run:
                    # Copy file
                    shutil.copy2(source_utci_file, dest_utci_file)
                    os.chmod(dest_utci_file, 0o644)
                    copied_count += 1
                    self.stdout.write(f"  ✓ Copied UTCI: {utci_filename}")

                    # Update database
                    utci_state = State.objects.filter(
                        scenario_type="utci", scenario_name=scenario_key
                    ).first()

                    if utci_state:
                        utci_data, _ = IndicatorData.objects.get_or_create(
                            indicator=climate_indicator, state=utci_state
                        )

                        image_path = (
                            f"indicators/climate/utci-scenarios/{utci_filename}"
                        )
                        IndicatorImage.objects.update_or_create(
                            indicatorData=utci_data, defaults={"image": image_path}
                        )
                        updated_count += 1
                else:
                    self.stdout.write(
                        f"  [DRY RUN] Would copy: {source_utci_file} -> {dest_utci_file}"
                    )
            else:
                self.stdout.write(
                    self.style.WARNING(f"  ⚠ UTCI image not found: {source_utci_file}")
                )

            # Process Plan image
            plan_filename = scenario_data["plan_image"]
            source_plan_file = source_plan / plan_filename
            dest_plan_file = dest_plan / plan_filename

            if source_plan_file.exists():
                if not dry_run:
                    # Copy file
                    shutil.copy2(source_plan_file, dest_plan_file)
                    os.chmod(dest_plan_file, 0o644)
                    copied_count += 1
                    self.stdout.write(f"  ✓ Copied Plan: {plan_filename}")

                    # Update database
                    plan_state = State.objects.filter(
                        scenario_type="plan", scenario_name=scenario_key
                    ).first()

                    if plan_state:
                        plan_data, _ = IndicatorData.objects.get_or_create(
                            indicator=climate_indicator, state=plan_state
                        )

                        image_path = (
                            f"indicators/climate/plan-scenarios/{plan_filename}"
                        )
                        IndicatorImage.objects.update_or_create(
                            indicatorData=plan_data, defaults={"image": image_path}
                        )
                        updated_count += 1
                else:
                    self.stdout.write(
                        f"  [DRY RUN] Would copy: {source_plan_file} -> {dest_plan_file}"
                    )
            else:
                self.stdout.write(
                    self.style.WARNING(f"  ⚠ Plan image not found: {source_plan_file}")
                )

        # Summary
        self.stdout.write(self.style.SUCCESS(f"\n{'=' * 60}"))
        if dry_run:
            self.stdout.write(self.style.SUCCESS(f"DRY RUN COMPLETE"))
            self.stdout.write(f"Would copy {copied_count} images")
            self.stdout.write(f"Would update {updated_count} database records")
        else:
            self.stdout.write(self.style.SUCCESS(f"IMPORT COMPLETE"))
            self.stdout.write(self.style.SUCCESS(f"✓ Copied {copied_count} images"))
            self.stdout.write(
                self.style.SUCCESS(f"✓ Updated {updated_count} database records")
            )
