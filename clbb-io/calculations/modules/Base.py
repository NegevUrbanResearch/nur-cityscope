import pandas as pd
import geopandas as gpd
import numpy as np
import glob
import os
from pathlib import Path
import json
from typing import Dict, List, Any, Optional
import logging

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

class BaseProcessor:
    """Base class for all data processors in the CLBB-CityScope system."""
    
    def __init__(self):
        self.logger = logging.getLogger(self.__class__.__name__)
        self.data_dir = Path('/app/data')
        self.raw_dir = self.data_dir / 'raw'
        self.processed_dir = self.data_dir / 'processed'
        self._setup_directories()
        
    def _setup_directories(self):
        """Create necessary directories if they don't exist."""
        for dir_path in [self.raw_dir, self.processed_dir]:
            for subdir in ['geojson', 'indicators', 'dashboard']:
                (dir_path / subdir).mkdir(parents=True, exist_ok=True)
                
    def validate_input_data(self, data: Any, schema: Dict) -> bool:
        """Validate input data against a schema."""
        # TODO: Implement schema validation
        return True
        
    def process_spatial_data(self, data: gpd.GeoDataFrame) -> Dict:
        """Process spatial data into standardized GeoJSON format."""
        try:
            # Ensure required fields exist
            required_fields = ['id', 'name', 'type', 'value', 'category', 'timestamp']
            for field in required_fields:
                if field not in data.columns:
                    raise ValueError(f"Missing required field: {field}")
                    
            # Convert to GeoJSON
            geojson = json.loads(data.to_json())
            
            # Validate structure
            if not self._validate_geojson(geojson):
                raise ValueError("Invalid GeoJSON structure")
                
            return geojson
            
        except Exception as e:
            self.logger.error(f"Error processing spatial data: {str(e)}")
            raise
            
    def process_indicator_data(self, data: pd.DataFrame) -> Dict:
        """Process indicator data into standardized format."""
        try:
            # Ensure required fields exist
            required_fields = ['indicator_id', 'name', 'description', 'unit']
            for field in required_fields:
                if field not in data.columns:
                    raise ValueError(f"Missing required field: {field}")
                    
            # Convert to standardized format
            indicator_data = {
                'indicator_id': data['indicator_id'].iloc[0],
                'name': data['name'].iloc[0],
                'description': data['description'].iloc[0],
                'unit': data['unit'].iloc[0],
                'values': {}
            }
            
            # Process values by neighborhood
            for _, row in data.iterrows():
                neighborhood_id = row['neighborhood_id']
                indicator_data['values'][neighborhood_id] = {
                    'value': float(row['value']),
                    'timestamp': row['timestamp'],
                    'metadata': row.get('metadata', {})
                }
                
            return indicator_data
            
        except Exception as e:
            self.logger.error(f"Error processing indicator data: {str(e)}")
            raise
            
    def process_dashboard_data(self, data: Dict) -> Dict:
        """Process dashboard data into standardized format."""
        try:
            # Ensure required fields exist
            required_fields = ['dashboard_id', 'title', 'description', 'charts']
            for field in required_fields:
                if field not in data:
                    raise ValueError(f"Missing required field: {field}")
                    
            # Validate chart data
            for chart in data['charts']:
                if not self._validate_chart_data(chart):
                    raise ValueError(f"Invalid chart data: {chart}")
                    
            return data
            
        except Exception as e:
            self.logger.error(f"Error processing dashboard data: {str(e)}")
            raise
            
    def _validate_geojson(self, geojson: Dict) -> bool:
        """Validate GeoJSON structure."""
        try:
            if geojson['type'] != 'FeatureCollection':
                return False
            if 'features' not in geojson:
                return False
            for feature in geojson['features']:
                if not all(k in feature for k in ['type', 'geometry', 'properties']):
                    return False
            return True
        except:
            return False
            
    def _validate_chart_data(self, chart: Dict) -> bool:
        """Validate chart data structure."""
        try:
            if 'type' not in chart or 'data' not in chart:
                return False
            if chart['type'] not in ['radar', 'bar', 'pie', 'horizontal_stacked_bar']:
                return False
            data = chart['data']
            if not all(k in data for k in ['categories', 'valuesSet1', 'valuesSet2', 'labels']):
                return False
            return True
        except:
            return False
            
    def save_processed_data(self, data: Dict, data_type: str, filename: str):
        """Save processed data to appropriate directory."""
        try:
            output_dir = self.processed_dir / data_type
            output_path = output_dir / filename
            
            if data_type == 'geojson':
                with open(output_path, 'w') as f:
                    json.dump(data, f)
            else:
                with open(output_path, 'w') as f:
                    json.dump(data, f, indent=2)
                    
            self.logger.info(f"Saved processed data to {output_path}")
            
        except Exception as e:
            self.logger.error(f"Error saving processed data: {str(e)}")
            raise
