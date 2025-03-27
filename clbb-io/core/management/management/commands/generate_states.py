from django.core.management.base import BaseCommand
from backend.models import State

class Command(BaseCommand):
    help = 'Genera las 128 combinaciones posibles de estados (0/1) para las claves "1" a "7".'

    def handle(self, *args, **options):
        keys = [str(i) for i in range(1, 8)]  # ["1", "2", "3", "4", "5", "6", "7"]

        # Eliminamos todos los registros previos (opcional, solo si queremos limpiar antes)
        State.objects.all().delete()

        created_count = 0
        # 2^7 = 128 combinaciones
        for num in range(128):
            # Convertir a binario con padding a 7 dígitos
            binary_str = format(num, '07b')
            state_dict = {keys[i]: int(binary_str[i]) for i in range(7)}

            # Crear y guardar la instancia
            State.objects.create(state_values=state_dict)
            created_count += 1

        self.stdout.write(self.style.SUCCESS(f'Se han creado {created_count} combinaciones de estados.'))
