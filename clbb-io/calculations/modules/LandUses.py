import geopandas as gpd
import numpy as np
import pandas as pd
from glob import glob
from modules.Base import BaseModule

class LandUses(BaseModule):
        def __init__(self) -> None:
            super().__init__()
            self.cols = ['Id', 'Uso', 'area_predio', 'geometry']
            self.scenarios_status = [0]*self.num_plates
            self.load_data()
            pass

        def load_data(self):
            self.scenarios = []
            [self.scenarios.append(gpd.read_parquet(file).to_crs(self.default_crs)) for file in glob('/app/assets/land_uses/*.parquet')]
            # [gdf['ID_PLACA'].fillna(0, inplace=True) for gdf in self.scenarios];
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
 
        def get_current_land_uses(self):
             return self.current_scenario

        def go_to_scenario(self, scenario_id):
            self.current_scenario = self.scenarios[scenario_id]
            pass