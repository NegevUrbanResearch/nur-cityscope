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
                'file_path': self._get_layer_path('layers', 'migrashim_simplified.json'),
                'order': 1
            },
            {
                'name': 'roads',
                'display_name': 'Roads',
                'file_path': self._get_layer_path('layers', 'small_roads_simplified.json'),
                'order': 2
            },
            {
                'name': 'majorRoads',
                'display_name': 'Major Roads',
                'file_path': self._get_source_layer_path('road-big.geojson'),
                'order': 3
            },
            {
                'name': 'smallRoads',
                'display_name': 'Small Roads',
                'file_path': self._get_source_layer_path('Small-road-limited.geojson'),
                'order': 4
            }
        ]

        for layer_info in layers_to_import:
            file_path = os.path.normpath(layer_info['file_path'])
            if os.path.exists(file_path):
                with open(file_path) as f:
                    geojson_data = json.load(f)

                layer, created = GISLayer.objects.get_or_create(
                    table=otef_table,
                    name=layer_info['name'],
                    defaults={
                        'display_name': layer_info['display_name'],
                        'layer_type': 'geojson',
                        'data': geojson_data,
                        'order': layer_info['order'],
                        'style_config': self._get_default_style(layer_info['name'])
                    }
                )
                if created:
                    self.stdout.write(
                        self.style.SUCCESS(f'✓ Imported {layer_info["name"]} layer')
                    )
                else:
                    layer.data = geojson_data
                    layer.save()
                    self.stdout.write(
                        self.style.SUCCESS(f'✓ Updated {layer_info["name"]} layer')
                    )
            else:
                self.stdout.write(
                    self.style.WARNING(
                        f'⚠️ Layer file not found: {file_path}'
                    )
                )

        self.stdout.write(
            self.style.SUCCESS('\n[SUCCESS] OTEF data import completed!')
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
