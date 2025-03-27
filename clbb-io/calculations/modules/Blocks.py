import geopandas as gpd
import numpy as np
import pandas as pd
from glob import glob
from modules.Base import BaseModule

class Blocks(BaseModule):
    def __init__(self, as_unit=False) -> None:
        super().__init__()
        self.cols = ['block_id', 'q_residents','geometry']
        self.scenarios_status = [0]*self.num_plates
        self.node_set = None
        self.load_data()
        pass

    def load_data(self):
        self.scenarios = []
        [self.scenarios.append(gpd.read_parquet(file).to_crs(self.default_crs)) for file in glob('/app/assets/blocks/*.parquet')]
        self.current_scenario = self.scenarios[0]
        pass

    def get_current_scenario(self):
        return self.current_scenario
    
    def go_to_scenario(self, scenario_id):
        self.current_scenario = self.scenarios[scenario_id]
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