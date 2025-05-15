from django.core.management.base import BaseCommand
from backend.models import (
    Indicator, State, IndicatorData, IndicatorGeojson,
    LayerConfig, DashboardFeedState, MapType
)
import random
from datetime import datetime
import os
import json
import pydeck as pdk
import pandas as pd

"""
Dashboard Data Structure Documentation:

1. Mobility Dashboard:
   - Basic Metrics:
     - total_population: Total population count
     - public_transport_coverage: Percentage of area covered by public transport
     - average_commute_time: Average commute time in minutes
   - Visualizations:
     - radar: Mobility-related metrics (walkability, public transport, bike lanes)
     - trafficLight: Key mobility indicators with status
     - dataTable: Detailed mobility metrics by district

2. Climate Dashboard:
   - Basic Metrics:
     - green_space_percentage: Percentage of green space
     - air_quality_index: Current air quality index
     - carbon_emissions: Total carbon emissions in tons
   - Visualizations:
     - radar: Climate-related metrics (air quality, emissions, green space)
     - stackedBar: Environmental indicators over time
     - horizontalStackedBar: Climate impact by sector

3. Land Use Dashboard:
   - Basic Metrics:
     - average_building_height: Average building height in meters
     - mixed_use_ratio: Ratio of mixed-use buildings
     - population_density: Population per square kilometer
   - Visualizations:
     - radar: Land use metrics (density, mixed-use, building height)
     - table: Land use distribution by district
     - stackedBar: Building types distribution

Each dashboard type should maintain consistent data structures while focusing on relevant metrics.
"""

class Command(BaseCommand):
    help = 'Creates sample data for the CLBB-CityScope application'

    def generate_dashboard_data(self, state, dashboard_type):
        """Generate dashboard-specific data based on type and state"""
        year_factor = (state.state_values['year'] - 2023) / 17  # Normalized factor (0 to 1)
        
        # Dashboard-specific metrics and categories
        dashboard_configs = {
            'mobility': {
                'metrics': {
                    'total_population': int(800000 * (1 + year_factor * 0.4)),
                    'public_transport_coverage': float(f"{min(100, 40 + year_factor * 30):.2f}"),
                    'average_commute_time': float(f"{30 * (1 - year_factor * 0.2):.2f}"),
                    'bike_lane_coverage': float(f"{min(100, 35 + year_factor * 35):.2f}")
                },
                'radar_categories': [
                    "Walkability", "Public Transport", "Bike Lanes", 
                    "Traffic Flow", "Accessibility", "Pedestrian Safety",
                    "Transit Frequency", "Last Mile", "Mobility Hubs",
                    "Car Sharing", "Bike Sharing", "Parking",
                    "Mobility Score"
                ],
                'stacked_bar_categories': ["Public Transport", "Active Transport", "Private Vehicles"],
                'horizontal_bar_categories': ["Accessibility", "Connectivity", "Coverage"],
                'traffic_light_categories': ["Public Transport", "Bike Infrastructure", "Pedestrian Safety"],
                'data_table_categories': ["Public Transport", "Active Transport"]
            },
            'climate': {
                'metrics': {
                    'total_population': int(800000 * (1 + year_factor * 0.4)),
                    'air_quality_index': float(f"{min(100, 60 + year_factor * 20):.2f}"),
                    'carbon_emissions': int(1000000 * (1 - year_factor * 0.3)),
                    'renewable_energy_percentage': float(f"{min(100, 30 + year_factor * 40):.2f}"),
                    'green_space_percentage': float(f"{min(100, 25 + year_factor * 30):.2f}")
                },
                'radar_categories': [
                    "Air Quality", "Green Space", "Carbon Emissions", 
                    "Energy Efficiency", "Waste Management", "Water Quality",
                    "Biodiversity", "Urban Heat", "Storm Water",
                    "Renewable Energy", "Energy Consumption", "Waste Reduction",
                    "Climate Score"
                ],
                'stacked_bar_categories': ["Renewable Energy", "Green Space", "Waste Reduction"],
                'horizontal_bar_categories': ["Transport", "Buildings", "Industry"],
                'traffic_light_categories': ["Air Quality", "Energy Efficiency", "Waste Management"],
                'data_table_categories': ["Energy", "Waste"]
            },
            'land_use': {
                'metrics': {
                    'total_population': int(800000 * (1 + year_factor * 0.4)),
                    'mixed_use_ratio': float(f"{min(100, 30 + year_factor * 40):.2f}"),
                    'population_density': int(5000 * (1 + year_factor * 0.5)),
                    'public_space_percentage': float(f"{min(100, 25 + year_factor * 35):.2f}"),
                    'average_building_height': float(f"{15 * (1 + year_factor * 0.5):.2f}")
                },
                'radar_categories': [
                    "Density", "Mixed-Use", "Building Height", 
                    "Land Efficiency", "Public Space", "Housing Diversity",
                    "Commercial Mix", "Cultural Space", "Green Space",
                    "Accessibility", "Connectivity", "Urban Form",
                    "Land Use Score"
                ],
                'stacked_bar_categories': ["Residential", "Commercial", "Mixed-Use"],
                'horizontal_bar_categories': ["Density", "Diversity", "Accessibility"],
                'traffic_light_categories': ["Mixed-Use", "Public Space", "Housing Diversity"],
                'data_table_categories': ["Land Use", "Building Types"]
            }
        }
        
        config = dashboard_configs[dashboard_type]
        
        # Generate radar chart data
        radar_data = {
            'categories': config['radar_categories'],
            'valuesSet1': [
                min(100, 45 + year_factor * 25 + random.uniform(-5, 5)) for _ in range(len(config['radar_categories']))
            ],
            'valuesSet2': [
                min(100, 60 + random.uniform(-10, 10)) for _ in range(len(config['radar_categories']))
            ]
        }
        
        # Generate horizontal stacked bar data
        horizontal_stacked_bar = {
            'bars': [
                {
                    "name": category,
                    "values": [
                        min(100, 40 + year_factor * 20 + random.uniform(-5, 5)),
                        min(100, 30 + year_factor * 15 + random.uniform(-5, 5)),
                        min(100, 20 + year_factor * 10 + random.uniform(-5, 5))
                    ]
                } for category in config['horizontal_bar_categories']
            ]
        }
        
        # Generate stacked bar data
        stacked_bar = {
            'bars': [
                {
                    "name": category,
                    "values": [
                        min(100, 40 + year_factor * 20 + random.uniform(-5, 5)),
                        100 - min(100, 40 + year_factor * 20 + random.uniform(-5, 5))
                    ]
                } for category in config['stacked_bar_categories']
            ]
        }
        
        # Generate data table
        data_table = {
            "categories": [
                {
                    "name": category,
                    "indicators": {
                        "current": min(100, 70 + year_factor * 15 + random.uniform(-5, 5)),
                        "target": min(100, 60 + year_factor * 20 + random.uniform(-5, 5))
                    }
                } for category in config['data_table_categories']
            ]
        }
        
        # Generate traffic light data
        traffic_light = [
            {
                "name": category,
                "value": min(100, 70 + year_factor * 15 + random.uniform(-5, 5))
            } for category in config['traffic_light_categories']
        ]
        
        # Combine all components
        dashboard_data = {
            **config['metrics'],
            'radar': radar_data,
            'horizontalStackedBar': horizontal_stacked_bar,
            'stackedBar': stacked_bar,
            'dataTable': data_table,
            'trafficLight': traffic_light
        }
        
        return dashboard_data

    def generate_pydeck_map(self, indicator_name, state_year, output_dir='media/maps'):
        """Generate a sample map visualization using PyDeck"""
        # Create the directory if it doesn't exist
        os.makedirs(output_dir, exist_ok=True)
        
        # Generate sample data for BioBio region
        # Center around Concepción, Chile
        center_lat, center_lon = -36.8274, -73.0498
        
        # Create grid of points
        num_points = 40
        points = []
        for i in range(num_points):
            lat = center_lat + random.uniform(-0.15, 0.15)
            lon = center_lon + random.uniform(-0.15, 0.15)
            
            # Value based on indicator type
            if 'Population' in indicator_name:
                value = random.uniform(500, 5000)
            elif 'Green Space' in indicator_name:
                value = random.uniform(10, 40)
            elif 'Building Height' in indicator_name:
                value = random.uniform(5, 50)
            elif 'Mobility' in indicator_name:
                value = random.uniform(0, 100)
            elif 'Climate' in indicator_name:
                value = random.uniform(0, 100)
            elif 'Land Use' in indicator_name:
                value = random.uniform(0, 100)
            else:
                value = random.uniform(0, 100)
            
            # Increase values for future projections
            year_factor = (state_year - 2023) / 17
            value = value * (1 + year_factor * 0.2)
            
            points.append({
                'lat': lat,
                'lng': lon,
                'value': value,
                'radius': value / 50  # Scale radius according to value
            })
        
        # Convert to DataFrame for PyDeck
        df = pd.DataFrame(points)
        
        # Create the PyDeck visualization
        layer = pdk.Layer(
            'ScatterplotLayer',
            df,
            get_position=['lng', 'lat'],
            get_radius='radius',
            get_fill_color=[
                'max(0, 255 - value * 2.55)', 
                'min(255, value * 2.55)', 
                '100',
                180
            ],
            pickable=True,
            opacity=0.8,
            stroked=True,
            filled=True
        )
        
        # Set the view state
        view_state = pdk.ViewState(
            latitude=center_lat,
            longitude=center_lon,
            zoom=10,
            pitch=0
        )
        
        # Create the deck
        deck = pdk.Deck(
            layers=[layer],
            initial_view_state=view_state,
            tooltip={"text": "{value}"},
            map_style='mapbox://styles/mapbox/dark-v10'
        )
        
        # Generate HTML file name
        clean_name = indicator_name.replace('[SAMPLE] ', '').replace(' ', '_').lower()
        html_path = f"{output_dir}/{clean_name}_{state_year}.html"
        
        # Save as HTML
        deck.to_html(html_path)
        self.stdout.write(self.style.SUCCESS(f"Created map visualization: {html_path}"))
        
        return html_path

    def handle(self, *args, **options):
        # Create sample map types
        map_types = []
        sample_map_types = [
            {
                'name': '[SAMPLE] Current State',
                'description': 'Shows the current state of urban indicators',
                'is_active': True
            },
            {
                'name': '[SAMPLE] Future Projection',
                'description': 'Shows projected future state of urban indicators',
                'is_active': True
            }
        ]

        for map_type_data in sample_map_types:
            map_type, created = MapType.objects.get_or_create(
                name=map_type_data['name'],
                defaults=map_type_data
            )
            map_types.append(map_type)
            if created:
                self.stdout.write(self.style.SUCCESS(f'Created map type: {map_type.name}'))

        # Create sample indicators for the three main categories
        indicators = []
        sample_indicators = [
            {
                'indicator_id': 1,
                'name': '[SAMPLE] Mobility',
                'has_states': True,
                'description': 'Transportation and mobility metrics including public transport coverage and bicycle infrastructure'
            },
            {
                'indicator_id': 2,
                'name': '[SAMPLE] Climate',
                'has_states': True,
                'description': 'Environmental and climate metrics including green space coverage and air quality'
            },
            {
                'indicator_id': 3,
                'name': '[SAMPLE] Land Use',
                'has_states': True,
                'description': 'Urban form and land use metrics including building heights and mixed-use development'
            },
            {
                'indicator_id': 4,
                'name': '[SAMPLE] Population Density',
                'has_states': True,
                'description': 'Population density per square kilometer. Sample ranges: 1000-5000 people/km²'
            },
            {
                'indicator_id': 5,
                'name': '[SAMPLE] Green Space Coverage',
                'has_states': True,
                'description': 'Percentage of green space in the area. Sample ranges: 10-40%'
            },
            {
                'indicator_id': 6,
                'name': '[SAMPLE] Building Height',
                'has_states': True,
                'description': 'Average building height in meters. Sample ranges: 10-50m'
            }
        ]

        for indicator_data in sample_indicators:
            indicator, created = Indicator.objects.get_or_create(
                indicator_id=indicator_data['indicator_id'],
                defaults=indicator_data
            )
            indicators.append(indicator)
            if created:
                self.stdout.write(self.style.SUCCESS(f'Created indicator: {indicator.name}'))

        # Create sample states
        states = []
        sample_states = [
            {'year': 2023, 'scenario': 'current', 'label': '[SAMPLE] Current State'},
            {'year': 2025, 'scenario': 'projected', 'label': '[SAMPLE] Near Future'},
            {'year': 2030, 'scenario': 'projected', 'label': '[SAMPLE] Future'},
            {'year': 2040, 'scenario': 'projected', 'label': '[SAMPLE] Long-term Future'}
        ]

        for state_data in sample_states:
            state, created = State.objects.get_or_create(
                state_values=state_data
            )
            states.append(state)
            if created:
                self.stdout.write(self.style.SUCCESS(f'Created state: {state_data["label"]}'))

        def generate_sample_geojson(indicator_name, state_year):
            """Generate sample GeoJSON data based on indicator type and state"""
            base_value = {
                'Mobility': random.uniform(0, 100),
                'Climate': random.uniform(0, 100),
                'Land Use': random.uniform(0, 100),
                'Population Density': random.uniform(1000, 5000),
                'Green Space Coverage': random.uniform(10, 40),
                'Building Height': random.uniform(10, 50)
            }.get(indicator_name.replace('[SAMPLE] ', ''), 100)
            
            # Increase values for future projections
            year_factor = (state_year - 2023) / 17
            value = base_value * (1 + year_factor * 0.2)
            
            return {
                'type': 'FeatureCollection',
                'features': [
                    {
                        'type': 'Feature',
                        'properties': {
                            'value': value,
                            'timestamp': datetime.now().isoformat(),
                            'indicator': indicator_name,
                            'year': state_year
                        },
                        'geometry': {
                            'type': 'Polygon',
                            'coordinates': [
                                [
                                    [-73.5, -36.8],  # Sample coordinates for BioBio region
                                    [-73.4, -36.8],
                                    [-73.4, -36.7],
                                    [-73.5, -36.7],
                                    [-73.5, -36.8]
                                ]
                            ]
                        }
                    }
                ]
            }

        # Create sample indicator data and generate maps
        for indicator in indicators:
            for state in states:
                data, created = IndicatorData.objects.get_or_create(
                    indicator=indicator,
                    state=state
                )
                
                if created or True:  # Always regenerate maps and data
                    # Generate map visualization
                    html_path = self.generate_pydeck_map(
                        indicator.name, 
                        state.state_values['year']
                    )
                    
                    # Add sample geojson data
                    IndicatorGeojson.objects.update_or_create(
                        indicatorData=data,
                        defaults={
                            'geojson': generate_sample_geojson(indicator.name, state.state_values['year'])
                        }
                    )
                    
                    # Add sample layer config
                    LayerConfig.objects.update_or_create(
                        indicatorData=data,
                        defaults={
                            'layer_config': {
                                'opacity': 0.7,
                                'color': '#ff0000',
                                'fill': True,
                                'mapUrl': html_path
                            }
                        }
                    )
                    self.stdout.write(self.style.SUCCESS(f'Created/updated data for {indicator.name} - {state.state_values["label"]}'))

        # Create dashboard feed states for each type and state
        for state in states:
            for dashboard_type in ['mobility', 'climate', 'land_use']:
                dashboard_data = self.generate_dashboard_data(state, dashboard_type)
                
                # Create or update dashboard feed state
                feed_state, created = DashboardFeedState.objects.update_or_create(
                    state=state,
                    dashboard_type=dashboard_type,
                    defaults={'data': dashboard_data}
                )
                
                status = 'Created' if created else 'Updated'
                self.stdout.write(
                    self.style.SUCCESS(
                        f'{status} {dashboard_type} dashboard feed state for {state.state_values["label"]}'
                    )
                )

        self.stdout.write(self.style.SUCCESS('Sample data created successfully!')) 