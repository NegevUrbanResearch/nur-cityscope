import os
import shutil
import json
from django.core.management.base import BaseCommand
from backend.models import Indicator, State, IndicatorData, IndicatorImage

class Command(BaseCommand):
    help = 'Genera objetos IndicatorImage de forma masiva asumiendo que las imágenes están pre-copiadas en media/indicators/.'

    def handle(self, *args, **options):
        # Borrar todas las IndicatorImage previas (opcional, según tu lógica)
        IndicatorImage.objects.all().delete()

        # Carpeta donde tenemos las imágenes originales (por si deseas copiarlas dentro de este script)
        base_path = "/app/external_files/final_maps"

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

        # Lista para acumulación masiva
        images_to_create = []

        for item in data:
            indicator_id = item['id']
            indicator_obj = Indicator.objects.filter(indicator_id=indicator_id).first()
            if not indicator_obj:
                self.stdout.write(self.style.WARNING(f"No se encontró Indicator con id={indicator_id}. Se omite."))
                continue

            # Carpeta correspondiente a este indicador
            category_path = os.path.join(base_path, str(indicator_id))
            if not os.path.isdir(category_path):
                self.stdout.write(self.style.WARNING(f"No existe la carpeta: {category_path}, se omite."))
                continue

            # Recorrer las imágenes de la categoría
            for filename in os.listdir(category_path):
                # Verificar si el indicador tiene estados (has_states es boolean)
                if indicator_obj.has_states:
                    # Extraer la cadena binaria sin la extensión .png
                    if not filename.endswith(".png"):
                        continue
                    states_str = filename[:-4]  # Remover '.png'

                    # Validar longitud y caracteres
                    if len(states_str) != 7 or any(ch not in ('0', '1') for ch in states_str):
                        self.stdout.write(self.style.WARNING(
                            f"Nombre de archivo {filename} no tiene formato de 7 bits. Se omite."
                        ))
                        continue

                    # Construir el dict de estado
                    state_dict = {str(i+1): int(states_str[i]) for i in range(7)}

                    state_obj = State.objects.filter(state_values=state_dict).first()
                    if not state_obj:
                        self.stdout.write(self.style.WARNING(
                            f"No se encontró State con state_values={state_dict} para {filename}, se omite."
                        ))
                        continue
                else:
                    # Sin estados → un State vacío, por ejemplo
                    state_obj, _ = State.objects.get_or_create(state_values={})
                    if not state_obj:
                        self.stdout.write(self.style.WARNING(
                            f"No se encontró State con state_values={{}} para {filename}, se omite."
                        ))
                        continue

                # Verificar el IndicatorData
                indicator_data_obj = IndicatorData.objects.filter(
                    indicator=indicator_obj,
                    state=state_obj
                ).first()
                
                if not indicator_data_obj:
                    # Si se usó state_dict arriba, cuidado con NameError
                    # Asignar un valor para mostrarlo en el warning
                    missing_state = state_dict if indicator_obj.has_states else {}
                    self.stdout.write(self.style.WARNING(
                        f"No se encontró IndicatorData para indicator_id={indicator_id} y state={missing_state}, se omite {filename}."
                    ))
                    continue

                # Verificar si el archivo existe en /app/external_files/final_maps/...
                image_path = os.path.join(category_path, filename)
                if not os.path.isfile(image_path):
                    self.stdout.write(self.style.WARNING(f"No se encontró el archivo {image_path}, se omite."))
                    continue

                # --- (Opción A) Pre-copia manualmente a media/indicators/{indicator_id}/ ---
                # Descomenta si quieres copiar ahora en lugar de pre-copiar.
                local_media_dir = f"/app/media/indicators/{indicator_id}"
                os.makedirs(local_media_dir, exist_ok=True)
                local_media_path = os.path.join(local_media_dir, filename)
                shutil.copy2(image_path, local_media_path)

                # Ruta que se guardará en la BD
                # Recuerda: si MEDIA_ROOT=/app/media, entonces "indicators/{indicator_id}/filename"
                # apunta físicamente a /app/media/indicators/{indicator_id}/filename
                relative_path = f"indicators/{indicator_id}/{filename}"

                # Construir el objeto IndicatorImage sin llamar a .save()
                new_image = IndicatorImage(
                    indicatorData=indicator_data_obj,
                    # Asignamos la ruta relativa en el campo image
                    # Asumiendo que ya se copió el archivo a /app/media/indicators/{indicator_id}/
                    image=relative_path
                )
                images_to_create.append(new_image)

        # Creación masiva
        if images_to_create:
            IndicatorImage.objects.bulk_create(images_to_create, batch_size=1000)
            self.stdout.write(self.style.SUCCESS(
                f"Se crearon {len(images_to_create)} IndicatorImage de forma masiva."
            ))
        else:
            self.stdout.write(self.style.WARNING("No se crearon imágenes. Verifica tus datos o la carpeta base."))

