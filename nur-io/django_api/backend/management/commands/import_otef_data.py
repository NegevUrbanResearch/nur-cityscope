from django.core.management.base import BaseCommand
from backend.models import (
    Table,
    OTEFModelConfig,
    LayerGroup,
    LayerState,
    OTEFViewportState,
)
from backend.calibration_io import normalize_calibration_payload, write_model_bounds_to_storage
import json
import os
from pathlib import Path

from django.conf import settings


class Command(BaseCommand):
    help = 'Import OTEF model config and seed layer groups from processed manifests'

    def _model_bounds_candidates(self):
        """Paths to check for model-bounds.json (Docker mount, then repo-relative, then legacy)."""
        base = Path(settings.BASE_DIR)
        return [
            Path('/app/otef-interactive/frontend/data/model-bounds.json'),  # Docker mount
            base.resolve().parent.parent / 'otef-interactive' / 'frontend' / 'data' / 'model-bounds.json',
            base / 'public' / 'processed' / 'otef' / 'model-bounds.json',
        ]

    def handle(self, *args, **options):
        # Get OTEF table
        otef_table = Table.objects.filter(name='otef').first()
        if not otef_table:
            self.stdout.write(
                self.style.ERROR('[ERROR] OTEF table not found! Run migrations first.')
            )
            return

        # Import model config: try frontend data path first (Docker), then legacy locations
        model_bounds_path = None
        for p in self._model_bounds_candidates():
            if p.exists():
                model_bounds_path = p
                break

        if model_bounds_path:
            with open(model_bounds_path, encoding='utf-8') as f:
                raw_bounds = json.load(f)

            normalized = normalize_calibration_payload(raw_bounds)

            # Persist normalized model bounds config (keeps existing semantics but
            # adds bounds_polygon + viewer_angle_deg for consumers that need them).
            config, created = OTEFModelConfig.objects.get_or_create(
                table=otef_table,
                defaults={'model_bounds': normalized}
            )
            if created:
                self.stdout.write(self.style.SUCCESS('[OK] Imported model bounds'))
            else:
                config.model_bounds = normalized
                config.save()
                self.stdout.write(self.style.SUCCESS('[OK] Updated model bounds'))

            # Hydrate OTEFViewportState from normalized calibration so fresh
            # installs get bounds + orientation without requiring a manual apply.
            state, _ = OTEFViewportState.objects.get_or_create(
                table=otef_table,
                defaults={
                    'viewport': OTEFViewportState.DEFAULT_VIEWPORT.copy(),
                    'layers': OTEFViewportState.DEFAULT_LAYERS.copy(),
                    'animations': {},
                },
            )
            state.bounds_polygon = normalized.get('bounds_polygon', [])
            state.viewer_angle_deg = normalized.get('viewer_angle_deg', 0.0)
            state.save()
            write_model_bounds_to_storage(normalized, config, str(model_bounds_path))
        else:
                self.stdout.write(
                    self.style.WARNING(
                    '[WARN] Model bounds file not found (tried frontend data and public/processed/otef).'
                )
            )

        # Seed layer groups from processed manifests
        self._seed_layer_groups(otef_table)

        self.stdout.write(
            self.style.SUCCESS('\n[SUCCESS] OTEF data import completed.')
        )

    def _seed_layer_groups(self, table):
        """Seed LayerGroup and LayerState from processed manifests"""
        # Use mounted public directory path (aligned with docker-compose volume mount)
        # This matches where nginx serves files and where frontend LayerRegistry loads from
        layers_manifest_path = '/app/public/processed/layers/layers-manifest.json'

        if not os.path.exists(layers_manifest_path):
            self.stdout.write(
                self.style.WARNING(f'[WARN] Layers manifest not found at: {layers_manifest_path}, skipping layer groups seeding')
            )
            return

        try:
            with open(layers_manifest_path, 'r', encoding='utf-8') as f:
                root_manifest = json.load(f)

            packs = root_manifest.get('packs', [])
            if not packs:
                self.stdout.write(
                    self.style.WARNING('[WARN] No packs found in layers manifest')
                )
                return

            self.stdout.write(f'\nSeeding layer groups from {len(packs)} pack(s) (source: {layers_manifest_path})...')

            for pack_id in packs:
                pack_manifest_path = f'/app/public/processed/layers/{pack_id}/manifest.json'

                if not os.path.exists(pack_manifest_path):
                    self.stdout.write(
                        self.style.WARNING(f'[WARN] Pack manifest not found: {pack_manifest_path}')
                    )
                    continue

                with open(pack_manifest_path, 'r', encoding='utf-8') as f:
                    pack_manifest = json.load(f)

                # Create or update LayerGroup
                # projector_base is the new default base for the projector
                group_enabled = (pack_id == 'projector_base')

                group, group_created = LayerGroup.objects.get_or_create(
                    table=table,
                    group_id=pack_id,
                    defaults={
                        'enabled': group_enabled
                    }
                )

                if group_created:
                    self.stdout.write(
                        self.style.SUCCESS(f'[OK] Created layer group: {pack_id} (enabled={group_enabled})')
                    )
                else:
                    # Update enabled state for existing group if it's projector_base
                    if group_enabled and not group.enabled:
                        group.enabled = True
                        group.save()
                        self.stdout.write(self.style.SUCCESS(f'[OK] Enabled layer group: {pack_id}'))

                # Process layers in this pack
                layers = pack_manifest.get('layers', [])
                for layer_info in layers:
                    layer_id = layer_info.get('id')
                    if not layer_id:
                        continue

                    # Full layer ID format: "group_id.layer_id"
                    full_layer_id = f"{pack_id}.{layer_id}"

                    # Default specific layers to enabled
                    layer_enabled = False
                    if full_layer_id in ['projector_base.SEA', 'projector_base.רקע_שחור']:
                        layer_enabled = True
                    # model_base defaults to disabled
                    if full_layer_id == 'projector_base.model_base':
                        layer_enabled = False

                    # Create or update LayerState
                    layer_state, layer_created = LayerState.objects.get_or_create(
                        table=table,
                        layer_id=full_layer_id,
                        defaults={
                            'enabled': layer_enabled
                        }
                    )

                    if layer_created:
                        self.stdout.write(
                            self.style.SUCCESS(f'  [OK] Created layer state: {full_layer_id} (enabled={layer_enabled})')
                        )
                    else:
                        # Update enabled state for existing important layers
                        if layer_enabled and not layer_state.enabled:
                            layer_state.enabled = True
                            layer_state.save()
                            self.stdout.write(self.style.SUCCESS(f'  [OK] Enabled layer state: {full_layer_id}'))

            self.stdout.write(
                self.style.SUCCESS(f'[OK] Seeded {len(packs)} layer group(s)')
            )

        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f'[ERROR] Error seeding layer groups: {e}')
            )
