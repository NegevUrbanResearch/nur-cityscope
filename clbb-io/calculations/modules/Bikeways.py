import geopandas as gpd
import numpy as np
import pandas as pd
from glob import glob
from modules.Base import BaseModule

class Bikeways(BaseModule):
    def __init__(self, as_unit=False) -> None:
        super().__init__()
        self.scenarios_status = [0]*self.num_plates
        self.node_set = None
        self.load_data()
        pass

    def load_data(self):
        self.scenarios = []
        [self.scenarios.append(gpd.read_parquet(file).to_crs(self.default_crs)) for file in glob('/app/assets/bikeway/*.parquet')]
        self.current_scenario = self.scenarios[0]
        pass

    def get_current_scenario(self):
        return self.current_scenario
    
    def go_to_scenario(self, scenario_id):
        self.current_scenario = self.scenarios[scenario_id]
        pass

    def calc_max_linear_meters(self):
        bikes = self.scenarios[2].copy()
        gdf = self.area_scope.copy()
        intersection = gpd.overlay(bikes, gdf, how='intersection')
        return intersection['length'].sum()

    def calc_linear_meters(self):
        bikes = self.current_scenario.copy()
        gdf = self.area_scope.copy()
        intersection = gpd.overlay(bikes, gdf, how='intersection')
        return intersection['length'].sum()/self.calc_max_linear_meters()

    def calculate_lineal_meters_by_neighborhoods(self):
        gdf = gpd.read_file('/app/assets/neighborhoods/all').to_crs(32718)
        bikes = self.current_scenario.copy()
        bikes_kpis = {}
        bikes_kpis['concepcion'] = bikes['length'].sum()
        intersection = gpd.overlay(bikes, gdf, how='intersection')
        intersection['lower_name'] = intersection['Nombre'].str.lower().str.replace(' ', '_')
        intersection_group = intersection.groupby('lower_name')['length'].agg('sum').reset_index().set_index('lower_name')['length'].to_dict()
        bikes_kpis = {**bikes_kpis, **intersection_group}
        return bikes_kpis

