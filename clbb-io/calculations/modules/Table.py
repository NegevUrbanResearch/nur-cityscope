import pandas as pd
import geopandas as gpd
import numpy as np
import json
import os
from pathlib import Path
import logging
from .Base import BaseModule
import random

class TableUserInferface(BaseModule):
    def __init__(self):
        super().__init__()
        self.heat_maps = {}
        self.json_data = None
        self.logger = logging.getLogger(self.__class__.__name__)
        self.export_dir = Path('/app/export')
        self.export_dir.mkdir(parents=True, exist_ok=True)
        
    def update_plate_status(self, plate_id, scenario_id):
        """Update the status of a specific plate"""
        if plate_id in self.plate_states:
            self.plate_states[plate_id] = scenario_id
        else:
            self.logger.error(f"Plate ID {plate_id} not found")
    
    def calc_heatmaps_kpis(self):
        """Calculate heatmaps and KPIs based on current plate states"""
        # This would normally involve complex spatial calculations
        # For now, we'll create placeholder data
        self.logger.info("Calculating heatmaps and KPIs")
        
        # Create placeholder heatmap data
        for key in ["population", "amenities", "green_space"]:
            self.heat_maps[key] = self._generate_placeholder_geodata(key)
    
    def _generate_placeholder_geodata(self, data_type):
        """Generate placeholder GeoDataFrame for visualization purposes"""
        # In a real implementation, this would use actual spatial calculations
        gdf = self.area_scope.copy()
        
        # Add some random data values
        num_features = len(gdf)
        gdf["value"] = np.random.random(num_features) * 100
        gdf["type"] = data_type
        
        return gdf
    
    def generate_json_data(self):
        """Generate JSON data structure for frontend charts and components"""
        self.logger.info("Generating JSON data for frontend")
        
        # Calculate some basic metrics from the heatmaps
        population_value = self._get_avg_value("population") 
        amenities_value = self._get_avg_value("amenities")
        green_space_value = self._get_avg_value("green_space")
        building_height = random.uniform(20, 80)
        
        # The exact structure needed by the frontend
        # This matches response.data in App.js
        dashboard_data = [
            {
                "data": {
                    "total_population": population_value * 10000,  # Raw population number
                    "average_building_height": building_height,    # Height value
                    "green_space_percentage": green_space_value    # Percentage
                },
                "state": self.plate_states
            }
        ]
        
        # Additional data for other visualizations if we add them later
        additional_data = {
            "radar": {
                "categories": [
                    "Population_d", "Amenities_d", "Green_Space_d", 
                    "Proximity", "Land Uses", "Diversity", 
                    "Distance_d", "Building_d", "Walkability",
                    "Housing_d", "Proximity_Live", "Public_Space",
                    "Mobility"
                ],
                "valuesSet1": [
                    population_value, 
                    amenities_value, 
                    green_space_value,
                    random.uniform(65, 95),
                    random.uniform(65, 95),
                    random.uniform(65, 95),
                    random.uniform(65, 95),
                    random.uniform(65, 95),
                    random.uniform(65, 95),
                    random.uniform(65, 95),
                    random.uniform(65, 95),
                    random.uniform(65, 95),
                    random.uniform(65, 95)
                ],
                "valuesSet2": [
                    92.37, 45.02, 87.30, 69.87, 79.30, 88.09,
                    79.17, 59.10, 91.54, 7.50, 43.00, 47.17, 55.00
                ]
            },
            "horizontalBar": {
                "bars": [
                    {"name": "Proximity", "values": [45, 35, 20]},
                    {"name": "Density", "values": [30, 40, 30]},
                    {"name": "Diversity", "values": [25, 35, 40]}
                ]
            },
            "trafficLight": [
                {"name": "Walkability", "indicator1": random.uniform(70, 95)},
                {"name": "Public Transport", "indicator1": random.uniform(50, 90)},
                {"name": "Green Space", "indicator1": random.uniform(40, 85)}
            ],
            "table": {
                "indicators": ["Population", "Buildings", "Amenities"],
                "cities": [
                    {
                        "name": "District A",
                        "values": [population_value, building_height, amenities_value]
                    },
                    {
                        "name": "District B",
                        "values": [population_value * 0.7, building_height * 0.8, amenities_value * 0.9]
                    }
                ]
            },
            "dataTable": {
                "categories": [
                    {
                        "name": "Walkability",
                        "indicators": {
                            "indicator1": random.uniform(70, 95),
                            "indicator2": random.uniform(60, 90)
                        }
                    },
                    {
                        "name": "Accessibility",
                        "indicators": {
                            "indicator1": random.uniform(50, 85),
                            "indicator2": random.uniform(45, 80)
                        }
                    }
                ]
            }
        }
        
        # Store the exact structure needed by the DashboardFeedState model
        self.json_data = dashboard_data
        
        # Log the data structure
        self.logger.info(f"Generated JSON data: {json.dumps(dashboard_data[0]['data'])}")
    
    def _get_avg_value(self, heatmap_key):
        """Get average value from a heatmap, or generate a random value if not available"""
        if heatmap_key in self.heat_maps:
            return self.heat_maps[heatmap_key]["value"].mean()
        return random.uniform(40, 95)
    
    def export_json_data(self, combination):
        """Export the generated JSON data to a file"""
        if self.json_data is None:
            self.logger.error("No JSON data to export. Call generate_json_data() first.")
            return
        
        # Export JSON data to a file
        export_path = self.export_dir / combination / "dashboard_data.json"
        os.makedirs(export_path.parent, exist_ok=True)
        
        with open(export_path, 'w') as f:
            json.dump(self.json_data, f, indent=2)
            
        self.logger.info(f"Exported JSON data to {export_path}") 