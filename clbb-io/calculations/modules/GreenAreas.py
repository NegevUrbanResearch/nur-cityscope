import geopandas as gpd
import numpy as np
import pandas as pd
from glob import glob
from modules.Base import BaseModule

class GreenAreas(BaseModule):
    def __init__(self, mode=None) -> None:
        super().__init__()
        self.cols = ['TIPO_EP', 'ID_AV', 'plate_id', 'geometry']
        self.scenarios_status = [0]*self.num_plates
        self.node_set = None
        self.load_data()
        pass

    def load_data(self):
        self.scenarios = []
        # [self.scenarios.append(gpd.read_file(file)[self.cols].to_crs(self.default_crs)) for file in glob('/app/assets/green_areas/*')]
        [self.scenarios.append(gpd.read_parquet(file)[self.cols].to_crs(self.default_crs)) for file in glob('/app/assets/green_areas/*.parquet')]
        [gdf['plate_id'].fillna(0, inplace=True) for gdf in self.scenarios];
        self.current_scenario = self.scenarios[0]
        pass

    def _update_plate_area(self, plate_id, scenario_id):
        
        current_data = self.current_scenario
        current_data = current_data[current_data['plate_id']!=plate_id]

        new_data = self.scenarios[scenario_id]
        new_data = new_data[new_data['plate_id']==plate_id]

        update_data = pd.concat([current_data, new_data])
        update_data = gpd.GeoDataFrame(data=update_data.drop(columns=['geometry']), geometry=update_data['geometry'])

        self.current_scenario = update_data
        pass

    def go_to_scenario(self, scenario_id):
        self.current_scenario = self.scenarios[scenario_id]
        pass

    def get_green_areas_ids(self):
        return list(self.current_scenario['ID_AV'].unique())
    
    def get_green_area_by_id(self, green_area_id):
        mask = (self.current_scenario['ID_AV'].isin([green_area_id]))
        return self.current_scenario[mask]
    
    def get_countour_by_id(self, green_area_id):
        return list(self.get_green_area_by_id(green_area_id).iloc[0]['geometry'].exterior.coords)
    
    def get_green_areas(self):
        return self.current_scenario