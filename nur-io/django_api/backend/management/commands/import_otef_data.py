from django.core.management.base import BaseCommand
from backend.models import Table, GISLayer, OTEFModelConfig
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

        # Import GIS layers
        layers_to_import = [
            {
                'name': 'parcels',
                'display_name': 'Parcels (Migrashim)',
                'file_name': 'migrashim_simplified.json',
                'source_type': 'processed',
                'order': 1
            },
            {
                'name': 'roads',
                'display_name': 'Roads',
                'file_name': 'small_roads_simplified.json',
                'source_type': 'processed',
                'order': 2
            },
            {
                'name': 'majorRoads',
                'display_name': 'Major Roads',
                'file_name': 'road-big.geojson',
                'source_type': 'source',
                'order': 3
            },
            {
                'name': 'smallRoads',
                'display_name': 'Small Roads',
                'file_name': 'Small-road-limited.geojson',
                'source_type': 'source',
                'order': 4
            }
        ]

        # Ensure media layers directory exists
        layers_media_dir = os.path.join(settings.MEDIA_ROOT, 'layers')
        os.makedirs(layers_media_dir, exist_ok=True)

        for layer_info in layers_to_import:
            # Determine source path
            if layer_info['source_type'] == 'processed':
                source_path = self._get_layer_path('layers', layer_info['file_name'])
            else:
                source_path = self._get_source_layer_path(layer_info['file_name'])

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

        self.stdout.write(
            self.style.SUCCESS('\n[SUCCESS] OTEF data import completed! Layers optimized.')
        )

    def _get_layer_path(self, *path_parts):
        """Get layer file path from public/processed/otef/"""
        # path_parts: e.g., ('layers', 'filename.json')
        return os.path.join(
            settings.BASE_DIR, 'public', 'processed', 'otef', *path_parts
        )

    def _get_source_layer_path(self, filename):
        """Get source layer file path from public/processed/otef/layers/"""
        # Source layers are copied here by setup/reset scripts
        return os.path.join(
            settings.BASE_DIR, 'public', 'processed', 'otef', 'layers', filename
        )

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
