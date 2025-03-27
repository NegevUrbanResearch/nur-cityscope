import geopandas as gpd
import numpy as np
import pandas as pd
from glob import glob
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
from .myfunctions import *
import itertools
import json
from modules import Base, Streets, GreenAreas, Amenities, LandUses, Blocks, SidewalkMaterial, Buildings, Bikeways

class TableUserInferface(Base.BaseModule):
    ######################################################################
    #### Funciones generales del modulo
    ######################################################################

    def __init__(self) -> None:
        super().__init__()
        self.st = Streets.Streets()
        self.ga = GreenAreas.GreenAreas()
        self.am = Amenities.Amenities()
        self.lu = LandUses.LandUses()
        self.bk = Blocks.Blocks()
        self.sm = SidewalkMaterial.SidewalkMaterial()
        self.bl = Buildings.Buildings()
        self.bw = Bikeways.Bikeways()
        self.modules_available = [
            'GreenAreas',
            'Streets',
            'Amenities',
            'LandUses',
            'Blocks',
            'Buildings',
            'Bikeways',
        ]
        self.dict_scenarios = {
            0: 'actual',
            1: 'future',
        }
        self.present_scenario = 0
        self.load_unit()
        self.update_nodes_ids()

        # Para guardar los heatmaps que se van creando o guardando
        self.heat_maps = {}

        # Para guardar los kpis numericos (ciclovias y estado de las calles)
        self.numeric_kpis = {}

        # Para ir agregando los valores para el radar chart
        self.radar_kpis = {}

        # Para guardar los kpis del grafico de proximidades
        self.proximity_kpis = {}

        # Para guardar los valores de los usos de suelo para la torta.
        self.land_uses_kpis = {}

        # Para guardar los valores del gráfico de densidades
        self.density_kpis = {}
        pass

    def reset_json_data(self):
        # Para guardar los heatmaps que se van creando o guardando
        self.heat_maps = {}

        # Para guardar los kpis numericos (ciclovias y estado de las calles)
        self.numeric_kpis = {}

        # Para ir agregando los valores para el radar chart
        self.radar_kpis = {}

        # Para guardar los kpis del grafico de proximidades
        self.proximity_kpis = {}

        # Para guardar los valores de los usos de suelo para la torta.
        self.land_uses_kpis = {}

        # Para guardar los valores del gráfico de densidades
        self.density_kpis = {}
        pass

    def load_heatmaps_from_folder(self, combination):
        folder = os.path.join('/app/export', combination)
        parquet_files = glob(os.path.join(folder, '*.parquet'))
        for pfile in parquet_files:
            name = os.path.split(pfile)[-1].replace('.parquet', '')
            self.heat_maps[name] = gpd.read_parquet(pfile)
        pass

    def update_plate_status(self, plate_id, scenario_id):
        self.plate_states[plate_id] = scenario_id
        self.st._update_plate_area(plate_id,scenario_id)
        self.ga._update_plate_area(plate_id,scenario_id)
        self.am._update_plate_area(plate_id,scenario_id)
        self.lu._update_plate_area(plate_id,scenario_id)
        self.bk._update_plate_area(plate_id,scenario_id)
        self.bl._update_plate_area(plate_id,scenario_id)
        self.update_nodes_ids()


    def change_scenario(self, scenario_id):
        if self.present_scenario!=scenario_id:
            self.st.go_to_scenario(scenario_id)
            self.ga.go_to_scenario(scenario_id)
            self.am.go_to_scenario(scenario_id)
            self.lu.go_to_scenario(scenario_id)
            self.bk.go_to_scenario(scenario_id)
            self.bl.go_to_scenario(scenario_id)
            self.bw.go_to_scenario(scenario_id)
            self.update_nodes_ids()
            self.present_scenario=scenario_id
            if self.select_unit == 'block': self.load_unit(select_unit='block')
        pass

    def update_nodes_ids(self):
        self.calc_ga_node_ids()
        self.calc_am_node_ids()
        self.calc_unit_node_ids()
    
    def calc_heatmaps_kpis(self):
        if 'Amenities' in self.modules_available:
            self.calc_travel_time_to_amenities()
            self.calc_amenities_density()
            self.calc_amenities_density_interested_category()
        if 'GreenAreas' in self.modules_available: self.calc_travel_time_to_green_areas()
        if 'LandUses' in self.modules_available: self.calc_land_uses_diversity()
        if 'Blocks' in self.modules_available: self.calc_population_density()
        if 'Buildings' in self.modules_available: self.calc_building_density()
        pass

    def calc_numeric_kpis(self):
        if 'Amenities' in self.modules_available: pass
        if 'GreenAreas' in self.modules_available: pass
        if 'LandUses' in self.modules_available: pass
        if 'Blocks' in self.modules_available: pass
        if 'Buildings' in self.modules_available: pass
        if 'Bikeways' in self.modules_available: pass
        pass

    def generate_export_json(self):
        json_export = {}
        json_export.update(self.radar_kpis)
        json_export.update(self.proximity_kpis)
        json_export.update(self.land_uses_kpis)
        json_export.update(self.density_kpis) 

    ######################################################################    
    #### Funciones de unidades espaciales
    ######################################################################

    def load_unit(self, select_unit='hex'):
        self.select_unit = select_unit
        if self.select_unit == 'block':
            filename = f'/app/assets/groupby/block/{self.dict_scenarios[self.present_scenario]}.parquet'
            unit = gpd.read_parquet(filename).to_crs(self.default_crs)
        else:
            unit = gpd.read_parquet(f'/app/assets/groupby/{self.select_unit}.parquet')
        unit['centroid'] = unit['geometry'].centroid
        unit['area'] = unit['geometry'].area
        self.unit = unit

        self.update_nodes_ids()
        pass

    def calc_unit_node_ids(self):
        self.unit['node_ids'] = self.st.current_scenario['net'].get_node_ids(
            self.unit['centroid'].x,
            self.unit['centroid'].y
        )
        pass    

    ######################################################################
    #### Funciones para identificar nodos en lugares
    ######################################################################

    def calc_am_node_ids(self):
        self.am.node_set = self.am.current_scenario.copy()
        self.am.node_set['node_ids'] = self.st.current_scenario['net'].get_node_ids(
            self.am.node_set['geometry'].x,
            self.am.node_set['geometry'].y
        )
        self.am.node_set.drop_duplicates(subset=['Category', 'node_ids'], inplace=True)
        pass

    def calc_ga_node_ids(self):
        nodes_df, _ = self.st.get_current_nodes_and_edges()
        net = self.st.current_scenario['net']
        ga_idxs = self.ga.get_green_areas_ids()
        ga_nodes_set = []
        for idx in ga_idxs:
            points = pd.DataFrame(self.ga.get_countour_by_id(idx), columns=['x', 'y', 'key'])
            ga_nodes_ids = net.get_node_ids(points['x'], points['y'])
            ga_nodes = nodes_df[nodes_df['osmid'].isin(ga_nodes_ids)]
            ga_nodes['ID_AV'] = idx
            ga_nodes_set.append(ga_nodes)

        ga_nodes_set = pd.concat(ga_nodes_set)
        ga_nodes_set.drop_duplicates('osmid', inplace=True)
        ga_nodes_set.reset_index(inplace=True, drop=True)
        self.ga.node_set = ga_nodes_set
        pass
        
    ######################################################################
    #### Funciones para calculo de indicadores numericos
    ######################################################################

    def calc_sidewalk_kpis(self):
        self.numeric_kpis['SidewalkMaterial'] = self.sm.calculate_scoring()
        pass

    def calc_bicycle_route_kpis(self):
        self.numeric_kpis['BicycleRouteMeters'] = self.bw.calc_linear_meters()
        pass

    def get_proximity_gdf(self):
        proximity_gdf = []

        proximity_cols = ['source', 'destination', 'path_lengths', 'Category', 'hex_id', 'geometry', 'travel_time']

        listado_de_claves = list(self.heat_maps.keys())

        claves_proximidad = [clave for clave in listado_de_claves if clave.endswith('_proximity') and 'parque' not in clave and 'plaza' not in clave]

        for key in claves_proximidad:
            gdf = self.heat_maps[key].drop_duplicates(subset=['hex_id'])
            gdf = gdf[proximity_cols]
            proximity_gdf.append(gdf)

        claves_proximidad = [clave for clave in listado_de_claves if clave.endswith('_proximity') and (clave.startswith('plaza') or clave.startswith('parque'))]

        for key in claves_proximidad:
            gdf = self.heat_maps[key].drop_duplicates(subset=['hex_id'])
            gdf['Category'] = gdf['class'].map({'PK': 'Parque', 'SQ': 'Plaza'})
            gdf = gdf[proximity_cols]
            proximity_gdf.append(gdf)

        proximity_gdf = pd.concat(proximity_gdf)

        delete_categories = ['Aprovisionamiento']

        proximity_gdf['Category'] = proximity_gdf['Category'].str.replace('Cuidados', 'Salud')
        proximity_gdf = proximity_gdf[~proximity_gdf['Category'].isin(delete_categories)]
        return proximity_gdf
        
    def calc_num_proximity_ranges(self):
        ppl = self.heat_maps['population_density']
        ppl = ppl[['hex_id', 'population']]
        total_population = ppl['population'].sum()
        proximity_gdf = self.get_proximity_gdf()

        # Definimos los rangos
        rangos = [0, 10, 20]
        # Etiquetas para los rangos, ajusta según tus necesidades
        etiquetas = ['Alta', 'Media', 'Baja']
        # Creamos una nueva columna en el gdf para almacenar las etiquetas de los rangos
        proximity_gdf['proximidad'] = pd.cut(proximity_gdf['travel_time'], bins=rangos + [float('inf')], labels=etiquetas, right=False)
        proximity_and_ppl_gdf = pd.merge(proximity_gdf, ppl, on='hex_id', how='outer')
        df = proximity_and_ppl_gdf.groupby(['Category', 'proximidad'])['population'].agg('sum').reset_index()
        df['population'] = 100*df['population']/total_population
        return df
    
    def num_proximity_to_json(self):
        df = self.calc_num_proximity_ranges()
        # Crear un diccionario en el formato deseado
        output = {
            "barrasHorizontalesStackeadas": {
                "barras": []
            }
        }
        # Iterar sobre las filas del DataFrame para crear la estructura deseada
        for nombre, group in df.groupby("Category"):
            valores = group["population"].tolist()
            output["barrasHorizontalesStackeadas"]["barras"].append({"nombre": nombre, "valores": valores})
        
        self.proximity_kpis.update(output)
        # json_output = json.dumps(output, indent=2)
        # return json_output
        pass
    
    def calc_radar_proximity(self):
        ppl = self.heat_maps['population_density']
        ppl = ppl[['hex_id', 'population']]

        total_population = ppl['population'].sum()
        proximity_gdf = self.get_proximity_gdf()
        proximity_and_ppl_gdf = pd.merge(proximity_gdf, ppl, on='hex_id', how='outer')
        proximity_and_ppl_gdf['travel_time*people'] = proximity_and_ppl_gdf['travel_time']*proximity_and_ppl_gdf['population']
        group_prox = proximity_and_ppl_gdf.groupby('Category')['travel_time*people'].agg('sum').reset_index()
        group_prox.rename(columns={'travel_time*people': 'summ'}, inplace=True)
        group_prox['summ'] = group_prox['summ']/total_population

        def mapeo_inverso_tiempo_viaje(valor):
            limit_time = 30

            if valor >= limit_time:
                return 0
            else:
                return 100 - (valor / limit_time) * 100
        
        group_prox['summ'] = group_prox['summ'].apply(mapeo_inverso_tiempo_viaje)
        return group_prox
    
    def radar_proximity_to_json(self):
        df = self.calc_radar_proximity()
        # Obtener las categorías y valores del DataFrame
        categorias = df["Category"].tolist()
        valores = df["summ"].tolist()

        # Crear un diccionario en el formato deseado
        radar_data = {
            "radar": {
                "categorias": categorias,
                "valoresSet1": valores
            }
        }

        self.radar_kpis.update(radar_data)
        # # Convertir a JSON y mostrarlo
        # json_output = json.dumps(radar_data, indent=2)
        # print(json_output)
        pass
    
    def radar_num_land_uses(self):
        lu = self.lu.get_current_land_uses()

        lu['area_predio'] = lu['geometry'].area

        total_area = lu['area_predio'].sum()

        gdf_group_uso = lu[['Uso', 'area_predio']].groupby('Uso')['area_predio'].agg('sum').reset_index().rename(columns={'area_predio':'area_uso'})
        gdf_group_uso['porcion_uso'] = gdf_group_uso['area_uso']/total_area
        gdf_group_uso['info_uso'] = -1*gdf_group_uso['porcion_uso']*np.log2(gdf_group_uso['porcion_uso'])
        diversity = gdf_group_uso['info_uso'].sum()

        try:
            del self.radar_kpis['Usos de Suelo']
        except:
            pass

        self.radar_kpis['radar']['categorias'].append('Usos de Suelo')
        self.radar_kpis['radar']['valoresSet1'].append(diversity)
        pass
    
    def calc_dist_land_uses(self):
        gdf = self.lu.get_current_land_uses()
        
        porcentaje_limit = 3

        # Calcular la distribución de Uso según area_predio
        uso_distribucion = gdf.groupby('Uso')['area_predio'].sum().reset_index()

        # Cambiar el nombre de la columna 'area_predio' a 'total_area_predio'
        uso_distribucion = uso_distribucion.rename(columns={'area_predio': 'total_area_predio'})

        # Calcular el porcentaje de área en relación con el total
        uso_distribucion['porcentaje_area'] = uso_distribucion['total_area_predio'] / uso_distribucion['total_area_predio'].sum() * 100

        uso_distribucion.loc[uso_distribucion['porcentaje_area']<porcentaje_limit,'Uso'] = 'OTROS'
        uso_distribucion = uso_distribucion.groupby(['Uso'])[['total_area_predio', 'porcentaje_area']].agg('sum').reset_index()

        return uso_distribucion
    
    def num_land_uses_to_json(self):
        uso_distribucion = self.calc_dist_land_uses()

        # Encuentra la longitud máxima en la columna "Uso"
        longitud_maxima = uso_distribucion['Uso'].str.len().max()

        uso_distribucion['Uso'] = uso_distribucion['Uso'].str.capitalize()
        uso_distribucion['Uso'] = uso_distribucion['Uso'].str.strip()
        uso_distribucion['Uso'] = uso_distribucion['Uso'].str.ljust(longitud_maxima)

        # Crear una lista de diccionarios en el formato deseado
        tipos = []
        for _, row in uso_distribucion.iterrows():
            tipo = {
                "nombre": row['Uso'],
                "valor": int(row['porcentaje_area'])  # Convierte el porcentaje a entero
            }
            tipos.append(tipo)

        # Crear el diccionario JSON final
        json_output = {
            "graficoDeTorta": {
                "tipos": tipos
            }
        }

        self.land_uses_kpis.update(json_output)
        pass

    def calc_numeric_densities(self):
        density_gdf = []
        listado_de_claves = self.heat_maps.keys()
        claves_densidad = [clave for clave in listado_de_claves if clave.endswith('_density')]
        # print(claves_densidad)
        cols = ['hex_id', 'Category', 'density', 'geometry']
        for key in claves_densidad:
            gdf = self.heat_maps[key].copy()
            gdf['Category'] = key
            if 'building' in key:
                pass
            elif 'population' in key:
                gdf.drop(columns='density', inplace=True)
                gdf.rename(columns={'population': 'density'}, inplace=True)
            else:
                gdf.drop(columns='density', inplace=True)
                gdf.rename(columns={'amenities_count': 'density'}, inplace=True)
            
            gdf = gdf[cols]
            density_gdf.append(gdf)
        density_gdf = pd.concat(density_gdf)
        density_gdf['Category'] = density_gdf['Category'].str.replace('cuidados', 'salud')
        density_gdf['Category'] = density_gdf['Category'].str.replace('_density', '')
        return density_gdf

    def calc_radar_densities(self):
        density_gdf = self.calc_numeric_densities()
        density_gdf['area'] = density_gdf['geometry'].area
        density_gdf = density_gdf[density_gdf['density'] > 0]
        group_gdf = density_gdf.groupby(['Category'])[['density', 'area']].agg('sum').reset_index()
        group_gdf['Category'] = group_gdf['Category'].str.replace('building', 'edificacion')
        group_gdf['Category'] = group_gdf['Category'].str.replace('population', 'poblacion')
        return group_gdf

    def radar_densities_to_json(self):
        df = self.calc_radar_densities()
        df['Category'] = df['Category'].str.capitalize()
        df['Category'] = df['Category'].apply(lambda x: x + '_d')
        radar_data = {
            "radar": {
                "categorias": df["Category"].tolist(),
                "valoresSet1": df["density"].tolist(),
            }
        }
        self.radar_kpis = {
            'radar': {
                'categorias': self.radar_kpis['radar']['categorias'] + radar_data['radar']['categorias'],
                'valoresSet1': self.radar_kpis['radar']['valoresSet1'] + radar_data['radar']['valoresSet1']
            }
        }

    def calc_bar_densities(self):
        df = self.calc_numeric_densities()
        neighborhoods = pd.concat(self.neighborhoods.values())

        df = gpd.sjoin(df, neighborhoods)
        df.rename(columns={'Nombre': 'barrio'}, inplace=True)
        dens_cols = ['hex_id', 'Category', 'density', 'barrio', 'geometry']
        df = df[dens_cols]
        df['area'] = df['geometry'].area

        vals_to_replace = ['salud', 'cultura', 'educacion']
        for val in vals_to_replace:
            df['Category'] = df['Category'].str.replace(val, 'amenities')

        group_df = df.groupby(['Category', 'barrio'])[['density', 'area']].agg('sum').reset_index()
        group_df.rename(columns={'density': 'count'}, inplace=True)
        group_df = group_df[['Category','barrio','count']]
        # Función para capitalizar palabras con más de 2 caracteres
        def capitalizar_palabras(texto):
            palabras = texto.split()
            palabras_capitalizadas = [palabra.capitalize() if len(palabra) > 2 else palabra.lower() for palabra in palabras]
            return " ".join(palabras_capitalizadas)

        # Aplicar la función a la columna "barrio"
        group_df["barrio"] = group_df["barrio"].apply(capitalizar_palabras)
        return group_df
    
    def bar_densities_to_json(self):
        df = self.calc_bar_densities()
        df['Category'] = df['Category'].str.replace('building', 'edificaciones')
        df['Category'] = df['Category'].str.replace('population', 'poblacion')
        df['Category'] = df['Category'].str.capitalize()

        # Reorganizar el DataFrame para tener las categorías como columnas
        df_pivot = df.pivot(index='barrio', columns='Category', values='count').reset_index()
        df_pivot.columns.name = None

        # Crear la estructura del JSON
        json_data = {
            "barrasStackeadas": {
                "xLabels": df_pivot.columns[1:].tolist(),
                "barras": []
            }
        }

        # Iterar a través de las filas del DataFrame para construir la lista de barras
        for index, row in df_pivot.iterrows():
            barra = {
                "nombre": row['barrio'],
                "valores": row[1:].tolist()
            }
            json_data["barrasStackeadas"]["barras"].append(barra)

        # # Obtener la lista de categorías únicas
        # categorias = df["Category"].unique()
        # print(df)
        # # Crear un diccionario para almacenar los datos
        # resultados = {}

        # for categoria in categorias:
        #     df_categoria = df[df["Category"] == categoria]
        #     barras = []

        #     for index, row in df_categoria.iterrows():
        #         nombre = row["barrio"]
        #         valores = df[df["barrio"] == nombre]["count"].tolist()
               
        #         barra = {"nombre": nombre, "valores": valores}
        #         barras.append(barra)

        #     resultados[categoria] = {"barras": barras}
        # print(resultados)
        self.density_kpis.update(json_data)
        pass

    ######################################################################
    #### Funciones para calculo de densidades
    ######################################################################

    def _calc_population_by_unit(self):
        if self.select_unit == 'block':
            self.population_by_unit = self.bk.get_current_scenario().rename(columns={'q_residents': 'population'})
        else:
            block_population = self.bk.get_current_scenario().copy()
            block_population['block_area'] = block_population.area
            intersection = gpd.overlay(self.unit, block_population, how='intersection')
            intersection['intersection_area'] = intersection.area
            intersection['population'] = intersection['q_residents']*intersection['intersection_area']/intersection[f'block_area']
            # Calcula la población dentro de cada unidad espacial
            population_by_unit = intersection.groupby(f'{self.select_unit}_id')['population'].sum().reset_index()
            # population_by_unit['population'] = np.round(population_by_unit['population'])
            population_by_unit = pd.merge(population_by_unit, self.unit, on=[f'{self.select_unit}_id'], how='outer')
            ppl_cols = [f'{self.select_unit}_id', 'population']
            population_by_unit = gpd.GeoDataFrame(data=population_by_unit[ppl_cols], geometry=population_by_unit['geometry'])
            population_by_unit['population'].fillna(0, inplace=True)
            self.population_by_unit = population_by_unit
        pass

    def calc_population_density(self):
        self._calc_population_by_unit()
        population_density = self.population_by_unit.copy()
        population_density = pd.merge(population_density, self.unit, on=[f'{self.select_unit}_id'])
        population_density['density'] = population_density['population']/population_density['area']
        ppl_density_cols = [f'{self.select_unit}_id', 'population', 'density', 'geometry_x']
        population_density = population_density[ppl_density_cols]
        self.population_density = gpd.GeoDataFrame(data=population_density.drop(columns=['geometry_x']), geometry=population_density['geometry_x'])
        self.heat_maps['population_density'] = self.population_density
        pass
    
    def calc_amenities_density(self):
        amenities = self.am.get_current_amenities().copy()

        join_result = gpd.sjoin(amenities, self.unit, how='inner', op='within')
        # count_by_unit = join_result.groupby(f'{select_unit}_id')['counter'].agg('sum').reset_index()
        count_by_unit = join_result.groupby(f'{self.select_unit}_id').size().reset_index(name='amenities_count')
        count_by_unit = pd.merge(count_by_unit, self.unit, on=[f'{self.select_unit}_id'], how='outer')
        count_by_unit['amenities_count'].fillna(0, inplace=True)
        count_cols = [f'{self.select_unit}_id', 'amenities_count', 'centroid', 'area']
        count_by_unit = gpd.GeoDataFrame(data=count_by_unit[count_cols], geometry=count_by_unit['geometry'])
        count_by_unit['density'] = count_by_unit['amenities_count']/count_by_unit['area']
        self.amenities_density = count_by_unit
        pass

    def calc_amenities_density_by_category(self, category):
        amenities = self.am.get_current_amenities().copy()
        amenities = amenities[amenities['Category']==category]
        join_result = gpd.sjoin(amenities, self.unit, how='inner', op='within')
        # count_by_unit = join_result.groupby(f'{select_unit}_id')['counter'].agg('sum').reset_index()
        count_by_unit = join_result.groupby(f'{self.select_unit}_id').size().reset_index(name='amenities_count')
        count_by_unit = pd.merge(count_by_unit, self.unit, on=[f'{self.select_unit}_id'], how='outer')
        count_by_unit['amenities_count'].fillna(0, inplace=True)
        count_cols = [f'{self.select_unit}_id', 'amenities_count', 'centroid', 'area']
        count_by_unit = gpd.GeoDataFrame(data=count_by_unit[count_cols], geometry=count_by_unit['geometry'])
        count_by_unit['density'] = count_by_unit['amenities_count']/count_by_unit['area']
        count_by_unit.drop(columns=['centroid'], inplace=True)
        cat = category.lower().replace(' ', '_')
        self.heat_maps[f'{cat}_density'] = count_by_unit
        return count_by_unit

    def calc_amenities_density_interested_category(self, interested_category=[]):
        if(len(interested_category)==0):
            interested_category = ['Educacion', 'Cultura', 'Cuidados']
        self.amenities_density_by_category = {}
        for category in interested_category:
            self.amenities_density_by_category[category] = self.calc_amenities_density_by_category(category=category)
        pass

    def calc_building_density(self):
        unit = self.unit.copy()
        unit_cols = [f'{self.select_unit}_id', 'area', 'geometry']
        unit = unit[unit_cols]

        buildings = self.bl.get_current_scenario().copy()
        buildings['area_construida'] = buildings.area
        buildings_cols = ['Pisos', 'Metros', 'area_construida', 'geometry']
        buildings = buildings[buildings_cols]
        
        joined_gdf = gpd.sjoin(unit, buildings)
        grouped_gdf = joined_gdf.groupby([f'{self.select_unit}_id'])['area_construida'].agg(['sum','count']).reset_index()
        merged_gdf = pd.merge(unit, grouped_gdf, on=f'{self.select_unit}_id')
        merged_gdf.rename(columns={'sum':'area_construida_total', 'count':'density'}, inplace=True)
        concat_gdf = pd.concat([merged_gdf, unit[~unit[f'{self.select_unit}_id'].isin(merged_gdf[f'{self.select_unit}_id'])]])
        concat_gdf['density'].fillna(0, inplace=True)
        concat_gdf['area_construida_total'].fillna(0, inplace=True)
        self.heat_maps[f'building_density'] = concat_gdf.copy()
        pass
    
    ######################################################################
    #### Funciones para calculo de diversidad
    ######################################################################

    def calc_land_uses_diversity(self):
        intersection = gpd.overlay(self.unit, self.lu.get_current_land_uses(), how='intersection')
        intersection['area_pol_inter'] = intersection.area
        intersection['area_unit'] = intersection['area']
        inter_cols = [f'{self.select_unit}_id', 'Uso', 'area', 'area_pol_inter', 'area_unit', 'area_predio']
        intersection = intersection[inter_cols]
        uses_inter_area = intersection.groupby([f'{self.select_unit}_id', 'Uso'])['area_pol_inter'].agg('sum').reset_index()
        total_inter_area = intersection.groupby([f'{self.select_unit}_id'])['area_pol_inter'].agg('sum').reset_index().rename(columns={'area_pol_inter': 'inter_area'})
        uses_inter_area = pd.merge(uses_inter_area, total_inter_area)
        uses_inter_area = pd.merge(uses_inter_area, self.unit[[f'{self.select_unit}_id', 'area']].rename(columns={'area': 'unit_area'}))
        uses_inter_area['property_percentage'] = uses_inter_area['area_pol_inter']/uses_inter_area['inter_area']
        uses_inter_area['information_per_property'] = -1*uses_inter_area['property_percentage']*np.log(uses_inter_area['property_percentage'])
        diversity = uses_inter_area.groupby(f'{self.select_unit}_id')['information_per_property'].agg('sum').reset_index()

        diversity_map = pd.merge(diversity, self.unit, on=f'{self.select_unit}_id')
        diversity_map.rename(columns={'information_per_property': 'diversity'}, inplace=True)
        self.lu_diversity = gpd.GeoDataFrame(data=diversity_map[[f'{self.select_unit}_id','diversity']], geometry=diversity_map['geometry'])
        sub_unit = self.unit.copy()
        unit_id = f'{self.select_unit}_id'
        mask = ~sub_unit[unit_id].isin(self.lu_diversity[unit_id])
        sub_unit = sub_unit[mask]
        sub_unit['diversity'] = np.nan
        self.lu_diversity = pd.concat([self.lu_diversity, sub_unit[[unit_id, 'diversity', 'geometry']]])
        self.lu_diversity['diversity'].fillna(0, inplace=True)
        self.heat_maps['land_uses_diversity'] = self.lu_diversity
        pass

    ######################################################################
    #### Funciones para calculo de proximidades
    ######################################################################

    def calc_travel_time_to_amenities(self):
        results_df = []
        # Calcular el camino más corto desde cada centroide de teselado hasta todos los nodos de amenities
        for index, row in self.am.get_current_amenities().iterrows():
            # print(row['geometry'])
            # print(row)
            destination_node_id = self.st.current_scenario['net'].get_node_ids([row['geometry'].x], [row['geometry'].y])
            destination_node_id = list(destination_node_id)[0]

            sources = self.unit['node_ids']
            destinations = [destination_node_id]*len(self.unit['node_ids'])

            shortest_paths = self.st.current_scenario['net'].shortest_path_lengths(sources, destinations)
            results_df.append(
                pd.DataFrame.from_dict(
                    {
                        'source': sources,
                        'destination': destinations,
                        f'{self.select_unit}_id': self.unit[f'{self.select_unit}_id'],
                        'Category': [row['Category']]*len(self.unit['node_ids']),
                        'path_lengths': shortest_paths,
                    }
                )
            )
        
        results_df = pd.concat(results_df)
        # display(results_df)

        # Encuentra el valor mínimo para cada categoría de amenity
        unit_cat = [f'{self.select_unit}_id','Category']
        paths_output = results_df.groupby(unit_cat)['path_lengths'].min().reset_index()
        paths_output = pd.merge(paths_output, results_df, on=unit_cat+['path_lengths'])
        paths_output = pd.merge(paths_output, self.unit[[f'{self.select_unit}_id','geometry']], on=f'{self.select_unit}_id')
        # display(paths_output)

        columns = ['source', 'destination', 'path_lengths', 'Category', f'{self.select_unit}_id', 'geometry']
        self.gdf_am_paths = gpd.GeoDataFrame(data=paths_output.drop(columns=['geometry']), geometry=paths_output['geometry'])
        self.gdf_am_paths = self.gdf_am_paths[columns]

        self.gdf_am_paths['travel_time'] = self.gdf_am_paths['path_lengths'].apply(calcular_tiempo)

        categories = self.gdf_am_paths['Category'].unique()
        for category in categories:
            cat = category.lower().replace(' ','_')
            self.heat_maps[f'{cat}_proximity'] = self.gdf_am_paths[self.gdf_am_paths['Category']==category].reset_index()
        pass

        
    def calc_travel_time_to_green_areas(self):
        source = self.unit[[f'{self.select_unit}_id', 'node_ids']]
        destination = self.ga.node_set[['ID_AV', 'osmid']]

        combinations = list(itertools.product(source.to_records(index=False), destination.to_records(index=False)))
        combinations_list = [list(item1) + list(item2) for item1, item2 in combinations]
        df_columns = ['hex_id', 'source', 'ID_AV', 'destination']
        df_combinations = pd.DataFrame(combinations_list, columns=df_columns)
        df_combinations['path_lengths'] = self.st.current_scenario['net'].shortest_path_lengths(
            df_combinations['source'],
            df_combinations['destination']
        )
        df_combinations['class'] = df_combinations['ID_AV'].str[:2]
        min_lenght_idx = df_combinations.groupby(['hex_id', 'class'])['path_lengths'].idxmin().reset_index()
        min_paths = df_combinations.loc[min_lenght_idx['path_lengths']]
        min_paths['travel_time'] = min_paths['path_lengths'].apply(calcular_tiempo)
        min_paths = pd.merge(min_paths, self.unit[[f'{self.select_unit}_id', 'geometry']], on=[f'{self.select_unit}_id'])
        self.gdf_ga_paths = gpd.GeoDataFrame(data=min_paths.drop(columns=['geometry']), geometry=min_paths['geometry'])
        
        for real_class, _class in {'PARQUE': 'PK', 'PLAZA': 'SQ'}.items():
            r_class = real_class.lower()
            self.heat_maps[f'{r_class}_proximity'] = self.gdf_ga_paths[self.gdf_ga_paths['class']==_class].reset_index()
        pass

    ######################################################################
    #### Funciones GET
    ######################################################################

    def get_streets(self):
        return self.st if 'Streets' in self.modules_available else None
    
    def get_green_area(self):
        return self.ga if 'GreenAreas' in self.modules_available else None
    
    def get_amenities(self):
        return self.am if 'Amenities' in self.modules_available else None
    
    def get_travels_amenities(self):
        return self.gdf_am_paths
    
    def get_travels_green_areas(self):
        return self.gdf_ga_paths
    
    def get_amenities_categories(self):
        return self.am.get_categories()

    def get_travels_amenities_by_category(self, category):
        return self.gdf_am_paths[self.gdf_am_paths['Category']==category].drop(columns=['Category'])
    
    def get_travels_green_areas_by_class(self, green_area_class='PARQUE'):
        _class  = {'PARQUE': 'PK', 'PLAZA': 'SQ'}[green_area_class]
        return self.gdf_ga_paths[self.gdf_ga_paths['class']==_class].reset_index()
    
    def get_maps_green_areas(self):
        ret = {}
        for _class in ['PARQUE', 'PLAZA']:
            ret[_class] = self.get_travels_green_areas_by_class(_class)
        return ret

    ######################################################################
    #### Funciones de flujo de datos y archivos
    ######################################################################
    def save_heatmaps(self):
        scenario_str = self.dict_scenarios[self.present_scenario]
        path = os.path.join('/app/data/output', scenario_str)
        verificar_y_crear_directorio(path)
        [gdf.to_file(os.path.join(path, key)) for key, gdf in self.heat_maps.items()];
        pass

    def save_land_uses_diversity(self, path='/app/data/output/land_uses_diversity', zipped=True):
        
        scenario_name = self.dict_scenarios[self.present_scenario]
        scenario_path = f'{path}/{scenario_name}'
        verificar_y_crear_directorio(scenario_path)
        self.lu_diversity.to_file(scenario_path)

        if zipped:
            main = os.path.split(path)[-1]
            output_zip_path = f'/app/data/output/zip/{main}.zip'
            zip_folder(path, output_zip_path)
            
    def save_amenities_travels(self, path='/app/data/output/amenities_proximity', zipped=True):
        
        categories = self.get_amenities_categories()
        scenario_name = self.dict_scenarios[self.present_scenario]
        scenario_path = f'{path}/{scenario_name}'
        verificar_y_crear_directorio(scenario_path)
        for category in categories:
            filecat = category.lower().replace(' ','_')
            filename = f'{scenario_path}/{filecat}'
            self.get_travels_amenities_by_category(category).to_file(filename)

        if zipped:
            main = os.path.split(path)[-1]
            output_zip_path = f'/app/data/output/zip/{main}.zip'
            zip_folder(path, output_zip_path)
            
    def save_green_areas_travels(self, path='/app/data/output/green_areas_proximity', zipped=True):    
        
        scenario_name = self.dict_scenarios[self.present_scenario]
        scenario_path = f'{path}/{scenario_name}'
        verificar_y_crear_directorio(scenario_path)
        ga_travels = self.get_travels_green_areas()
        classes = list(ga_travels['class'].unique())
        [ga_travels[ga_travels['class']==_class].to_file(os.path.join(path, f'{scenario_path}_{_class}')) for _class in classes];
        
        if zipped:
            main = os.path.split(path)[-1]
            output_zip_path = f'/app/data/output/zip/{main}.zip'
            zip_folder(path, output_zip_path)
    
    def generate_json_data(self):

        self.calc_sidewalk_kpis() # Listo
        self.calc_bicycle_route_kpis() # Listo

        self.num_land_uses_to_json() # Listo
        self.radar_proximity_to_json() # Listo
        self.radar_num_land_uses() # Listo
        self.radar_densities_to_json() # Listo
        self.bar_densities_to_json() # Listo
        self.num_proximity_to_json() # Listo

        json_export = {}
        json_export.update(self.radar_kpis)
        json_export.update(self.proximity_kpis)
        json_export.update(self.land_uses_kpis)
        json_export.update(self.density_kpis)
        radar_list = json_export['radar']['valoresSet1']
        json_export['radar']['valoresSet2'] = [75]*len(radar_list)
        normalizer_multiply_radar = [1, 1, 1, 1, 1, 1, 1, 1, 0.01, 7.5, 1, 0.002, 5]
        radar_list_norm = [value*norm for value, norm in zip(radar_list, normalizer_multiply_radar)]
        json_export['radar']['valoresSet1'] = radar_list_norm

        normalizer_multiply_stackedbar = [ 50, 1/5, 1/20,]
        l = json_export['barrasStackeadas']['barras']
        for index, dt in enumerate(l):
            for k, v in dt.items():
                if(k=='valores'):
                    json_export['barrasStackeadas']['barras'][index]['valores'] = [value*norm for value, norm in zip(v, normalizer_multiply_stackedbar)]
        self.json_data = json_export
        pass

    def export_json_data(self, combination, save_path='/app/export/json'):
        filename = os.path.join(save_path, f'{combination}.json')
        with open(filename, "w") as archivo:
            json.dump(self.json_data, archivo, indent=4)
        self.reset_json_data()

