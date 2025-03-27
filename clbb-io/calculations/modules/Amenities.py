import geopandas as gpd
import numpy as np
import pandas as pd
from glob import glob
from modules.Base import BaseModule

class Amenities(BaseModule):
    def __init__(self) -> None:
        super().__init__()
        self.cols = ['id', 'Category', 'plate_id', 'geometry']
        self.scenarios_status = [0]*self.num_plates
        self.node_set = None
        self.load_data()
        pass

    def load_data(self):
        self.scenarios = []

        [self.scenarios.append(gpd.read_parquet(file)[self.cols].to_crs(self.default_crs)) for file in glob('/app/assets/amenities/*')]
        self.current_scenario = self.scenarios[0]
        self.categories = list(self.current_scenario['Category'].unique())
        pass
    
    def go_to_scenario(self, scenario_id):
        self.current_scenario = self.scenarios[scenario_id]
        pass

    def get_amenities_ids(self):
        return list(self.current_scenario['id'].unique())
    
    def get_categories(self):
        return self.categories
    
    def get_current_amenities(self):
        return self.current_scenario
    
    def get_current_amenities_by_category(self, category):
        return self.current_scenario[self.current_scenario['Category']==category]
    
    def amenities_points(self):
        gdf = self.current_scenario
        gdf['x'] = gdf['geometry'].x
        gdf['y'] = gdf['geometry'].y
        return gdf
    
    def export_as_csv(self):
        amenities = self.current_scenario.copy()
        amenities = amenities.to_crs(4326)
        amenities['x'] = amenities['geometry'].x
        amenities['y'] = amenities['geometry'].y
        amenities.to_csv('/app/data/output/amenities.csv', decimal=',', sep=';')
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
