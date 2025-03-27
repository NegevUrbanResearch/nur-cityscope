import geopandas as gpd
import numpy as np
import pandas as pd
from glob import glob
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
from itertools import product
from modules.Table import TableUserInferface
import os
import logging

# Configura el sistema de registros (logs)
logging.basicConfig(filename='/app/logs/registro.log', level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def get_change_to_apply(lista1, lista2):
    componentes_distintas = {}
    indices = [1, 2, 4, 5, 6, 7, 8]

    for indice, (valor_lista1, valor_lista2) in enumerate(zip(lista1, lista2)):
        if valor_lista1 != valor_lista2:
            componentes_distintas[indices[indice]] = valor_lista2
    
    return componentes_distintas

def carpeta_vacia(ruta_carpeta):
    # Enumera los archivos en la carpeta
    archivos = os.listdir(ruta_carpeta)
    
    # Comprueba si la lista de archivos está vacía
    if not archivos:
        return True
    else:
        return False

tui = TableUserInferface()
plates_ids = list(tui.plates.keys())
scenario_ids = [0, 1]

# Genera todas las combinaciones posibles de estados para los slots
combinaciones_estados = list(product(scenario_ids, repeat=len(plates_ids)))

# Crea un DataFrame con las combinaciones de estados
combinaciones_placas_estados = pd.DataFrame(combinaciones_estados, columns=plates_ids)

# Ruta de la carpeta de exportación
carpeta_exportacion = "/app/export/"

# Crea las carpetas con los nombres de las combinaciones de estados
for combinacion in combinaciones_estados:
    nombre_carpeta = ''.join(map(str, combinacion))  # Convierte la combinación en una cadena
    ruta_carpeta = os.path.join(carpeta_exportacion, nombre_carpeta)
    os.makedirs(ruta_carpeta, exist_ok=True)

for index, row in combinaciones_placas_estados.iterrows():
    folder = ''.join(row.values.astype(str))
    path = os.path.join(carpeta_exportacion, folder)

    logging.info(f'Procesando carpeta: {folder}, índice: {index}')

    if(carpeta_vacia(path)):
        tui = TableUserInferface()
        componentes_distintas = get_change_to_apply(list(tui.plate_states.values()), row.values)
        try:
            for plate_id, scenario in componentes_distintas.items():
                tui.update_plate_status(
                    plate_id=plate_id,
                    scenario_id=row[plate_id]
                )
            # tui.calc_population_density()
            # tui.calc_amenities_density()
            tui.calc_heatmaps_kpis()
            # heatmaps = tui.heat_maps
            logging.info(f'Guardando en carpeta: {folder}')
            tui.generate_json_data()
            tui.export_json_data(combination=folder)
            # [gdf.to_file(os.path.join(path, key)) for key, gdf in heatmaps.items()];
            # [gdf.to_parquet(os.path.join(path, f'{key}.parquet')) for key, gdf in heatmaps.items()];
        except Exception as e:
            logging.error(f'Error en carpeta: {folder}, error: {str(e)}')
    else:
        logging.info(f'Carpeta: {folder} ya contiene archivos')