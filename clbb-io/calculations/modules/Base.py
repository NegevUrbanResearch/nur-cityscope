import pandas as pd
import geopandas as gpd
import numpy as np
import glob
import os

class BaseModule():
    def __init__(self) -> None:
        self.default_crs = '32718'
        self.load_plates()
        self.load_area_scope()
        self.load_neighborhoods()
        pass

    def load_plates(self):
        plates_path = '/app/assets/plates'
        plates_files = glob.glob(os.path.join(plates_path, '*'))
        self.plates = {}
        self.plate_states = {}
        self.num_plates = 0
        for file in plates_files:
            idx = os.path.split(file)[-1]
            if not idx.isdigit():
            # Verifica si el nombre del archivo es un plate con numero
                continue
            else:
            # Convierte idx en un entero antes de agregarlo al diccionario
                idx = int(idx)
                plate = gpd.read_file(file).to_crs(self.default_crs)
                self.plates[idx] = plate
                self.plate_states[idx] = 0
                self.num_plates += 1
        pass

    def get_plate(self, plate_id):
        try:
            return self.plates[plate_id]
        except:
            print(f'Error getting plate {plate_id}, verify index')
            return None

    def load_area_scope(self):
        area_scope_path = '/app/assets/area_scope'
        self.area_scope = gpd.read_file(area_scope_path).to_crs(self.default_crs)
        pass

    def load_neighborhoods(self):
        neighborhood_path = '/app/assets/neighborhoods'
        extension = '.parquet'
        neighborhood_files = glob.glob(os.path.join(neighborhood_path, f'*{extension}'))
        self.neighborhoods = {os.path.split(parquet_file)[-1].replace(extension, ''): gpd.read_parquet(parquet_file).to_crs(self.default_crs) for parquet_file in neighborhood_files}
        pass
