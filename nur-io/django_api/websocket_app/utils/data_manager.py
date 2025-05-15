import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
from asgiref.sync import sync_to_async
from backend import models

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DataManager:
    """Unified data management for nur-CityScope."""
    
    def __init__(self):
        self.base_dir = Path('data')
        self.raw_dir = self.base_dir / 'raw'
        self.processed_dir = self.base_dir / 'processed'
        self.validation_dir = self.base_dir / 'validation'
        
        # Ensure directories exist
        self._create_directories()
        
        # Initialize data updater for real-time updates
        self.data_updater = DataUpdater()
    
    def _create_directories(self):
        """Create necessary directories if they don't exist."""
        directories = [
            self.raw_dir / 'indicators',
            self.raw_dir / 'geojson',
            self.raw_dir / 'images',
            self.processed_dir / 'indicators',
            self.processed_dir / 'dashboard',
            self.processed_dir / 'cache',
            self.validation_dir / 'schemas',
            self.validation_dir / 'rules'
        ]
        
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
    
    def validate_dashboard_feed_data(self, data: Dict[str, Any]) -> None:
        """Validate dashboard feed data structure."""
        required_fields = {
            'total_population': (int, float),
            'green_space_percentage': (int, float),
            'average_building_height': (int, float),
            'radar_chart': dict,
            'horizontal_stacked_bars': dict,
            'pie_chart': dict,
            'bar_chart': dict
        }
        
        for field, expected_type in required_fields.items():
            assert field in data, f"Missing required field: {field}"
            assert isinstance(data[field], expected_type), f"Invalid type for {field}"
    
    def validate_radar_chart_data(self, data: Dict[str, Any]) -> None:
        """Validate radar chart data structure."""
        required_fields = {
            'categories': list,
            'valuesSet1': list,
            'valuesSet2': list
        }
        
        for field, expected_type in required_fields.items():
            assert field in data, f"Missing required field in radar chart: {field}"
            assert isinstance(data[field], expected_type), f"Invalid type for radar chart {field}"
        
        assert len(data['categories']) == len(data['valuesSet1']) == len(data['valuesSet2']), \
            "All radar chart arrays must have the same length"
        
        for value in data['valuesSet1'] + data['valuesSet2']:
            assert 0 <= value <= 100, f"Radar chart values must be between 0 and 100, got {value}"
    
    def validate_horizontal_stacked_bar_data(self, data: Dict[str, Any]) -> None:
        """Validate horizontal stacked bar data structure."""
        assert 'bars' in data, "Missing 'bars' in horizontal stacked bar data"
        assert isinstance(data['bars'], list), "Horizontal stacked bar data must contain a list of bars"
        
        if not data['bars']:
            return
        
        first_bar = data['bars'][0]
        assert 'name' in first_bar, "Each bar must have a 'name'"
        assert 'values' in first_bar, "Each bar must have 'values'"
        assert len(first_bar['values']) == 3, "Each bar must have exactly 3 values (High, Medium, Low)"
        
        for bar in data['bars']:
            assert len(bar['values']) == 3, f"Bar {bar.get('name', 'unnamed')} must have exactly 3 values"
            assert sum(bar['values']) <= 100, f"Bar {bar.get('name', 'unnamed')} values must sum to 100 or less"
            for value in bar['values']:
                assert 0 <= value <= 100, f"Bar values must be between 0 and 100, got {value}"
    
    def validate_pie_chart_data(self, data: Dict[str, Any]) -> None:
        """Validate pie chart data structure."""
        assert 'labels' in data, "Missing 'labels' in pie chart data"
        assert 'values' in data, "Missing 'values' in pie chart data"
        
        assert len(data['labels']) == len(data['values']), \
            "Pie chart labels and values must have the same length"
        
        assert abs(sum(data['values']) - 100) < 0.01, \
            "Pie chart values must sum to 100"
    
    def validate_bar_chart_data(self, data: Dict[str, Any]) -> None:
        """Validate bar chart data structure."""
        assert 'labels' in data, "Missing 'labels' in bar chart data"
        assert 'values' in data, "Missing 'values' in bar chart data"
        
        assert len(data['labels']) == len(data['values']), \
            "Bar chart labels and values must have the same length"
        
        for value in data['values']:
            assert 0 <= value <= 100, f"Bar chart values must be between 0 and 100, got {value}"
    
    def validate_geojson_data(self, geojson: Dict[str, Any]) -> None:
        """Validate GeoJSON data structure."""
        assert geojson['type'] == 'FeatureCollection', "GeoJSON must be a FeatureCollection"
        assert 'features' in geojson, "GeoJSON must contain features"
        
        for feature in geojson['features']:
            assert feature['type'] == 'Feature', "Each feature must be of type 'Feature'"
            assert 'properties' in feature, "Each feature must have properties"
            assert 'geometry' in feature, "Each feature must have geometry"
            assert 'value' in feature['properties'], "Each feature must have a value property"
            assert isinstance(feature['properties']['value'], (int, float)), \
                "Feature value must be numeric"
    
    @sync_to_async
    def process_indicators(self) -> bool:
        """Process indicator data from raw files."""
        try:
            raw_indicators = self.raw_dir / 'indicators'
            processed_indicators = self.processed_dir / 'indicators'
            
            for file in raw_indicators.glob('*.json'):
                logger.info(f"Processing indicator file: {file}")
                with open(file) as f:
                    data = json.load(f)
                
                self.validate_radar_chart_data(data)
                
                output_file = processed_indicators / file.name
                with open(output_file, 'w') as f:
                    json.dump(data, f, indent=2)
                
                logger.info(f"Successfully processed {file.name}")
            
            return True
        except Exception as e:
            logger.error(f"Error processing indicators: {str(e)}")
            return False
    
    @sync_to_async
    def process_geojson(self) -> bool:
        """Process GeoJSON data from raw files."""
        try:
            raw_geojson = self.raw_dir / 'geojson'
            processed_geojson = self.processed_dir / 'indicators'
            
            for file in raw_geojson.glob('*.json'):
                logger.info(f"Processing GeoJSON file: {file}")
                with open(file) as f:
                    data = json.load(f)
                
                self.validate_geojson_data(data)
                
                output_file = processed_geojson / file.name
                with open(output_file, 'w') as f:
                    json.dump(data, f, indent=2)
                
                logger.info(f"Successfully processed {file.name}")
            
            return True
        except Exception as e:
            logger.error(f"Error processing GeoJSON: {str(e)}")
            return False
    
    @sync_to_async
    def process_dashboard_data(self) -> bool:
        """Process dashboard data from raw files."""
        try:
            raw_dashboard = self.raw_dir / 'dashboard'
            processed_dashboard = self.processed_dir / 'dashboard'
            
            for file in raw_dashboard.glob('*.json'):
                logger.info(f"Processing dashboard file: {file}")
                with open(file) as f:
                    data = json.load(f)
                
                self.validate_dashboard_feed_data(data)
                self.validate_radar_chart_data(data['radar_chart'])
                self.validate_horizontal_stacked_bar_data(data['horizontal_stacked_bars'])
                self.validate_pie_chart_data(data['pie_chart'])
                self.validate_bar_chart_data(data['bar_chart'])
                
                output_file = processed_dashboard / file.name
                with open(output_file, 'w') as f:
                    json.dump(data, f, indent=2)
                
                logger.info(f"Successfully processed {file.name}")
            
            return True
        except Exception as e:
            logger.error(f"Error processing dashboard data: {str(e)}")
            return False
    
    @sync_to_async
    async def process_all(self) -> bool:
        """Process all data types."""
        success = True
        
        if not await self.process_indicators():
            success = False
        if not await self.process_geojson():
            success = False
        if not await self.process_dashboard_data():
            success = False
        
        return success
    
    async def handle_data_update(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle real-time data updates."""
        return await self.data_updater.input_event(event)

# Initialize global data manager
data_manager = DataManager() 