import zipfile
import os

def verificar_y_crear_directorio(directory_path):
    # Verificar si el directorio ya existe
    if not os.path.exists(directory_path):
        try:
            # Crear el directorio si no existe
            os.makedirs(directory_path)
            print(f"Directorio '{directory_path}' creado con éxito.")
        except OSError as e:
            print(f"Error al crear el directorio '{directory_path}': {str(e)}")
    else:
        print(f"El directorio '{directory_path}' ya existe.")

def zip_folder(input_folder_path, output_zip_path):
    try:
        # Crear un objeto ZipFile en modo escritura
        with zipfile.ZipFile(output_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # Recorre todos los archivos y subdirectorios en la carpeta de entrada
            for root, _, files in os.walk(input_folder_path):
                for file in files:
                    # Obtiene la ruta completa del archivo
                    file_path = os.path.join(root, file)
                    
                    # Calcula la ruta relativa dentro del archivo .zip
                    relative_path = os.path.relpath(file_path, input_folder_path)
                    
                    # Agrega el archivo al archivo .zip con la ruta relativa
                    zipf.write(file_path, arcname=relative_path)

        print(f"Carpeta '{input_folder_path}' comprimida en '{output_zip_path}' con éxito.")
    except Exception as e:
        print(f"Error al comprimir la carpeta: {str(e)}")

def calcular_tiempo(distancia_metros):
    velocidad_kph = 4.5
    velocidad_mpm = velocidad_kph * 1000 / 60
    tiempo = (distancia_metros / velocidad_mpm)
    return tiempo