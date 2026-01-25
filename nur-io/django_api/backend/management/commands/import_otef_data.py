from django.core.management.base import BaseCommand
from backend.models import Table, GISLayer, OTEFModelConfig, LayerGroup, LayerState
import json
import os
from django.conf import settings


class Command(BaseCommand):
    help = 'Import OTEF GIS layers and model config into database'

    def handle(self, *args, **options):
        # Get OTEF table
        otef_table = Table.objects.filter(name='otef').first()
        if not otef_table:
            self.stdout.write(
                self.style.ERROR('[ERROR] OTEF table not found! Run migrations first.')
            )
            return

        # Import model config from public/processed/otef/
        model_bounds_path = os.path.join(
            settings.BASE_DIR, 'public', 'processed', 'otef', 'model-bounds.json'
        )

        if os.path.exists(model_bounds_path):
            with open(model_bounds_path) as f:
                bounds = json.load(f)

            config, created = OTEFModelConfig.objects.get_or_create(
                table=otef_table,
                defaults={'model_bounds': bounds}
            )
            if created:
                self.stdout.write(self.style.SUCCESS('✓ Imported model bounds'))
            else:
                config.model_bounds = bounds
                config.save()
                self.stdout.write(self.style.SUCCESS('✓ Updated model bounds'))
        else:
            self.stdout.write(
                self.style.WARNING(f'⚠️ Model bounds file not found at: {model_bounds_path}')
            )

        # Import GIS layers from processed _legacy pack
        # Legacy layers are now processed as a pack in public/processed/layers/_legacy/
        layers_to_import = [
            {
                'name': 'parcels',
                'display_name': 'Parcels (Migrashim)',
                'file_name': 'migrashim.geojson',  # Processed output name
                'order': 1
            },
            {
                'name': 'roads',
                'display_name': 'Roads',
                'file_name': 'small_roads.geojson',  # Processed output name
                'order': 2
            },
            {
                'name': 'majorRoads',
                'display_name': 'Major Roads',
                'file_name': 'road_big.geojson',  # Processed output name (normalized)
                'order': 3
            },
            {
                'name': 'smallRoads',
                'display_name': 'Small Roads',
                'file_name': 'small_road_limited.geojson',  # Processed output name (normalized)
                'order': 4
            }
        ]

        # Ensure media layers directory exists
        layers_media_dir = os.path.join(settings.MEDIA_ROOT, 'layers')
        os.makedirs(layers_media_dir, exist_ok=True)

        for layer_info in layers_to_import:
            # Load from processed _legacy pack
            source_path = self._get_legacy_pack_path(layer_info['file_name'])
            source_path = os.path.normpath(source_path)

            if os.path.exists(source_path):
                # Copy file to media directory instead of reading content
                dest_filename = f"{layer_info['name']}.geojson"
                dest_path = os.path.join(layers_media_dir, dest_filename)

                # Copy file
                import shutil
                shutil.copy2(source_path, dest_path)

                # Relative path for API
                media_relative_path = f"layers/{dest_filename}"

                layer, created = GISLayer.objects.get_or_create(
                    table=otef_table,
                    name=layer_info['name'],
                    defaults={
                        'display_name': layer_info['display_name'],
                        'layer_type': 'geojson',
                        'data': {},  # store empty data to keep DB light
                        'file_path': media_relative_path, # store path to file
                        'order': layer_info['order'],
                        'style_config': self._get_default_style(layer_info['name'])
                    }
                )
                if created:
                    self.stdout.write(
                        self.style.SUCCESS(f'✓ Imported {layer_info["name"]} layer (linked to file)')
                    )
                else:
                    layer.data = {} # convert existing heavy layers to light ones
                    layer.file_path = media_relative_path
                    layer.save()
                    self.stdout.write(
                        self.style.SUCCESS(f'✓ Updated {layer_info["name"]} layer (linked to file)')
                    )
            else:
                self.stdout.write(
                    self.style.WARNING(
                        f'⚠️ Layer file not found: {source_path}'
                    )
                )

        # Seed layer groups from processed manifests
        self._seed_layer_groups(otef_table)

        self.stdout.write(
            self.style.SUCCESS('\n[SUCCESS] OTEF data import completed! Layers optimized.')
        )

    def _get_legacy_pack_path(self, filename):
        """Get layer file path from processed _legacy pack"""
        # Legacy layers are processed as a pack in mounted public directory
        # Aligned with docker-compose volume mount: ./otef-interactive/public -> /app/public
        return f'/app/public/processed/layers/_legacy/{filename}'

    def _get_default_style(self, layer_name):
        """Get default style config for layer"""
        styles = {
            'parcels': {
                'color': '#6495ED',
                'fillColor': '#6495ED',
                'weight': 1,
                'fillOpacity': 0.3,
                'opacity': 0.8
            },
            'roads': {
                'color': '#FF6347',
                'weight': 2,
                'opacity': 0.8
            },
            'majorRoads': {
                'color': '#B22222',
                'weight': 4,
                'opacity': 0.9,
                'lineCap': 'round',
                'lineJoin': 'round'
            },
            'smallRoads': {
                'fillColor': '#A0A0A0',
                'fillOpacity': 0.6,
                'color': '#707070',
                'weight': 0.5,
                'opacity': 0.8
            }
        }
        return styles.get(layer_name, {})

    def _seed_layer_groups(self, table):
        """Seed LayerGroup and LayerState from processed manifests"""
        # Use mounted public directory path (aligned with docker-compose volume mount)
        # This matches where nginx serves files and where frontend LayerRegistry loads from
        layers_manifest_path = '/app/public/processed/layers/layers-manifest.json'

        if not os.path.exists(layers_manifest_path):
            self.stdout.write(
                self.style.WARNING(f'⚠️ Layers manifest not found at: {layers_manifest_path}, skipping layer groups seeding')
            )
            return

        try:
            with open(layers_manifest_path, 'r', encoding='utf-8') as f:
                root_manifest = json.load(f)

            packs = root_manifest.get('packs', [])
            if not packs:
                self.stdout.write(
                    self.style.WARNING('⚠️ No packs found in layers manifest')
                )
                return

            self.stdout.write(f'\nSeeding layer groups from {len(packs)} pack(s) (source: {layers_manifest_path})...')

            for pack_id in packs:
                pack_manifest_path = f'/app/public/processed/layers/{pack_id}/manifest.json'

                if not os.path.exists(pack_manifest_path):
                    self.stdout.write(
                        self.style.WARNING(f'⚠️ Pack manifest not found: {pack_manifest_path}')
                    )
                    continue

                with open(pack_manifest_path, 'r', encoding='utf-8') as f:
                    pack_manifest = json.load(f)

                # Create or update LayerGroup
                group, group_created = LayerGroup.objects.get_or_create(
                    table=table,
                    group_id=pack_id,
                    defaults={
                        'enabled': False  # Default all groups to disabled
                    }
                )

                if group_created:
                    self.stdout.write(
                        self.style.SUCCESS(f'✓ Created layer group: {pack_id}')
                    )

                # Process layers in this pack
                layers = pack_manifest.get('layers', [])
                for layer_info in layers:
                    layer_id = layer_info.get('id')
                    if not layer_id:
                        continue

                    # Full layer ID format: "group_id.layer_id"
                    full_layer_id = f"{pack_id}.{layer_id}"

                    # Create or update LayerState
                    layer_state, layer_created = LayerState.objects.get_or_create(
                        table=table,
                        layer_id=full_layer_id,
                        defaults={
                            'enabled': False  # Default all layers to disabled
                        }
                    )

                    if layer_created:
                        self.stdout.write(
                            self.style.SUCCESS(f'  ✓ Created layer state: {full_layer_id}')
                        )

            self.stdout.write(
                self.style.SUCCESS(f'✓ Seeded {len(packs)} layer group(s)')
            )

        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f'❌ Error seeding layer groups: {e}')
            )
