import geopandas as gpd
import numpy as np
import pandana as pdna
import pandas as pd
from glob import glob
import matplotlib.pyplot as plt
from modules.Base import BaseModule
import os
import warnings
warnings.filterwarnings("ignore")

class Streets(BaseModule):
    def __init__(self) -> None:
        super().__init__()
        self.nodes_cols = []
        self.edges_cols = []
        self.scenarios_status = [0]*self.num_plates
        self.load_data()
        pass

    def load_data(self):
        self.scenarios = []
        # Redirige la salida estándar a /dev/null (un objeto nulo)
        with open(os.devnull, 'w') as fnull:
            # Redirige la salida estándar a /dev/null temporalmente
            old_stdout = os.dup(1)
            os.dup2(fnull.fileno(), 1)
            [
                self.scenarios.append({
                        # 'nodes': gpd.read_file(node_file).to_crs(self.default_crs),
                        # 'edges': gpd.read_file(edge_file).to_crs(self.default_crs)
                        'nodes': gpd.read_parquet(node_file).to_crs(self.default_crs),
                        'edges': gpd.read_parquet(edge_file).to_crs(self.default_crs),
                        'net': pdna.Network.from_hdf5(net_file),
                })
                for node_file, edge_file, net_file in zip(
                    glob('/app/assets/streets/*/nodes.parquet'),
                    glob('/app/assets/streets/*/edges.parquet'),
                    glob('/app/assets/streets/*/net.h5')
                    )
            ]
            # Restaura la salida estándar original
            os.dup2(old_stdout, 1)
        # Assume that the baseline is in index 0
        self.current_scenario = self.scenarios[0]
        # self._make_network()
        pass

    def go_to_scenario(self, scenario_id):
        self.current_scenario = self.scenarios[scenario_id]
        # self._make_network()
        self.scenarios_status = [scenario_id]*self.num_plates
        for k, v in self.plate_states.items():
            self.plate_states[k] = scenario_id
        pass

    def update_network(self, plate_id, scenario_id):
        self._update_plate_area(plate_id=plate_id, scenario_id=scenario_id)
        # self._make_network()
        self.scenarios_status[plate_id] = scenario_id
        pass
    
    def scenario_id_from_plates_street_state(self):
        lower_plate = 6
        for key, value in self.plate_states.items():
            if key >= lower_plate and value == 1:
                return 1
        return 0
    
    def _update_plate_area(self, plate_id, scenario_id):
        self.plate_states[plate_id] = scenario_id
        self.current_scenario = self.scenarios[self.scenario_id_from_plates_street_state()]
        # self._make_network()
        pass

    def _current_nodes_edges_to_net_format(self):
        nodes_df = self.current_scenario['nodes']
        edges_df = self.current_scenario['edges']

        nodes = pd.DataFrame(
            {
                'osmid': nodes_df['osmid'].astype(int),
                'lat' : nodes_df.geometry.y.astype(float),
                'lon' : nodes_df.geometry.x.astype(float),
                'y' : nodes_df.geometry.y.astype(float),
                'x' : nodes_df.geometry.x.astype(float),
            }
        )
        nodes['id'] = nodes['osmid'].values

        nodes = gpd.GeoDataFrame(data=nodes, geometry=nodes_df.geometry)
        nodes.set_index('osmid', inplace=True)
        nodes.drop_duplicates(inplace=True)

        edges = pd.DataFrame(
            {
                'u': edges_df['u'].astype(int),
                'v': edges_df['v'].astype(int),
                'from': edges_df['u'].astype(int),
                'to': edges_df['v'].astype(int),
                'osmid': edges_df['osmid'].astype(int),
                'length': edges_df['length'].astype(float)
            }
        )
        edges['key'] = 0
        edges['key'] = edges['key'].astype(int)
        edges = gpd.GeoDataFrame(data=edges, geometry=edges_df.geometry)
        edges.set_index(['u', 'v', 'key'], inplace=True)
        edges.drop_duplicates(inplace=True)
        return nodes, edges
    
    def _make_network(self):
        import os
        nodes, edges = self._current_nodes_edges_to_net_format()
        # Redirige la salida estándar a /dev/null (un objeto nulo)
        with open(os.devnull, 'w') as fnull:
            # Redirige la salida estándar a /dev/null temporalmente
            old_stdout = os.dup(1)
            os.dup2(fnull.fileno(), 1)
            # Tu código para crear la red de Pandana aquí
            self.current_scenario['net'] = pdna.Network(
                nodes['lon'],
                nodes['lat'],
                edges['from'],
                edges['to'],
                edges[['length']]
            )
            # Restaura la salida estándar original
            os.dup2(old_stdout, 1)
        pass

    def get_current_nodes_and_edges(self):
        return self.current_scenario['nodes'], self.current_scenario['edges']
    
    def get_current_scenario_status(self):
        return self.scenarios_status