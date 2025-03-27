import os
import json
from django.core.management.base import BaseCommand
from backend.models import State, DashboardFeedState  # Asegúrate de ajustar la ruta según tu estructura

class Command(BaseCommand):
    help = 'Crea objetos DashboardFeedState a partir de archivos JSON en external_files/json/'

    def handle(self, *args, **options):
        # Definir la ruta al directorio de archivos JSON
        json_dir = os.path.join('/app', 'external_files', 'json')

        if not os.path.exists(json_dir):
            self.stdout.write(self.style.ERROR(f'El directorio {json_dir} no existe.'))
            return

        # Opcional: Eliminar objetos existentes si deseas empezar de cero
        DashboardFeedState.objects.all().delete()
        self.stdout.write(self.style.WARNING('Se han eliminado todos los objetos existentes de DashboardFeedState.'))

        created_count = 0

        # Iterar sobre cada archivo JSON en el directorio
        for filename in os.listdir(json_dir):
            if not filename.endswith('.json'):
                continue

            encoded_str = filename[:-5]  # Remover '.json'

            # Validar el formato del nombre del archivo
            if len(encoded_str) != 7 or not all(c in '01' for c in encoded_str):
                self.stdout.write(self.style.WARNING(f'Se omite archivo con nombre inválido: {filename}'))
                continue

            # Decodificar el nombre del archivo a un diccionario state_values
            state_values = {str(i+1): int(c) for i, c in enumerate(encoded_str)}

            # Buscar el objeto State correspondiente
            try:
                state = State.objects.get(state_values=state_values)
            except State.DoesNotExist:
                self.stdout.write(self.style.ERROR(f'No se encontró State para {state_values} (archivo: {filename})'))
                continue
            except State.MultipleObjectsReturned:
                self.stdout.write(self.style.ERROR(f'Múltiples States encontrados para {state_values} (archivo: {filename})'))
                continue

            # Cargar los datos del archivo JSON
            file_path = os.path.join(json_dir, filename)
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except json.JSONDecodeError as e:
                self.stdout.write(self.style.ERROR(f'Error al parsear JSON en {filename}: {e}'))
                continue
            except Exception as e:
                self.stdout.write(self.style.ERROR(f'Error al leer {filename}: {e}'))
                continue

            # Crear el objeto DashboardFeedState
            dashboard_feed_state, created = DashboardFeedState.objects.get_or_create(
                state=state,
                defaults={'data': data}
            )

            if created:
                created_count += 1
            else:
                self.stdout.write(self.style.WARNING(f'DashboardFeedState ya existe para State {state.id} (archivo: {filename})'))

        self.stdout.write(self.style.SUCCESS(f'Se han creado {created_count} objetos DashboardFeedState.'))
