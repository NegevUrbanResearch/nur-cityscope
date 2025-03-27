import geopandas as gpd
import numpy as np
import pandas as pd
from glob import glob
from modules.Base import BaseModule

class SidewalkMaterial(BaseModule):
    def __init__(self) -> None:
        super().__init__()
        self.scenarios_status = [0]*self.num_plates
        self.load_data()
        pass

    def load_data(self):
        self.scenarios = []
        [self.scenarios.append(gpd.read_parquet(file).to_crs(self.default_crs)) for file in glob('/app/assets/sidewalk_material/*.parquet')]
        self.current_scenario = self.scenarios[0]
        pass
    
    def get_current_scenario(self):
        return self.current_scenario
    
    def go_to_scenario(self, scenario_id):
        self.current_scenario = self.scenarios[scenario_id]
        pass

    def calculate_scoring(self, material_scores = {'Adoquines': 0.5, 'Pavimento': 1, 'Tierra': -3,}):
        gdf = self.current_scenario
        agg = gdf.groupby(['Tipo'])['length'].agg('sum').reset_index()
        total_length = agg['length'].sum()
        agg['length_percentage'] = agg['length']/total_length
        agg['score'] = agg['Tipo'].map(material_scores)
        agg['length_score'] = agg['length_percentage']*agg['score']
        return agg['length_score'].sum()