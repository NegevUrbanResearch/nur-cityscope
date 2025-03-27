import os
import json
from django.core.management.base import BaseCommand
from backend.models import Indicator  # Ajusta el modelo si es necesario

class Command(BaseCommand):
    help = 'Genera indicadores a partir de un archivo JSON ubicado en sources/indicator_ids.json'

    def handle(self, *args, **options):
        Indicator.objects.all().delete()
        # Determinar la ruta del archivo JSON relativo al directorio de este comando
        base_dir = os.path.dirname(__file__)
        json_path = os.path.join(base_dir, 'sources', 'indicator_ids.json')
        
        # Cargar el archivo JSON
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except FileNotFoundError:
            self.stdout.write(self.style.ERROR('No se encontró el archivo indicator_ids.json en sources/'))
            return
        except json.JSONDecodeError as e:
            self.stdout.write(self.style.ERROR(f'Error de parsing JSON: {e}'))
            return

        # Suponiendo que data es una lista de IDs o un diccionario
        # que contenga IDs u otra info para generar indicadores
        created_count = 0
        for item in data:
            # Ajusta la lógica según la estructura del JSON.
            # Por ejemplo, si el JSON es una lista de IDs:
            indicator_id = int(item['id'])  # Si es una lista simple
            name = item['name']
            has_states = bool(item['states'])
            # Crear el indicador en la base de datos
            Indicator.objects.create(indicator_id=indicator_id, name=name, has_states=has_states)
            
            created_count += 1

        self.stdout.write(self.style.SUCCESS(f'Se han creado {created_count} indicadores.'))
