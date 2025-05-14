from django.core.management.base import BaseCommand
from backend.models import (
    Indicator, State, IndicatorData, IndicatorGeojson,
    LayerConfig, DashboardFeedState, MapType
)
import random
from datetime import datetime

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
                    'renewable_energy_percentage': float(f"{min(100, 30 + year_factor * 40):.2f}")
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
                    'public_space_percentage': float(f"{min(100, 25 + year_factor * 35):.2f}")
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

        # Create sample indicators
        indicators = []
        sample_indicators = [
            {
                'indicator_id': 1,
                'name': '[SAMPLE] Population Density',
                'has_states': True,
                'description': 'Population density per square kilometer. Sample ranges: 1000-5000 people/km²'
            },
            {
                'indicator_id': 2,
                'name': '[SAMPLE] Green Space Coverage',
                'has_states': True,
                'description': 'Percentage of green space in the area. Sample ranges: 10-40%'
            },
            {
                'indicator_id': 3,
                'name': '[SAMPLE] Building Height',
                'has_states': True,
                'description': 'Average building height in meters. Sample ranges: 10-50m'
            },
            {
                'indicator_id': 4,
                'name': '[SAMPLE] Traffic Flow',
                'has_states': True,
                'description': 'Average daily traffic flow. Sample ranges: 1000-5000 vehicles/day'
            },
            {
                'indicator_id': 5,
                'name': '[SAMPLE] Air Quality',
                'has_states': True,
                'description': 'Air quality index. Sample ranges: 0-200'
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
                'Population Density': random.uniform(1000, 5000),
                'Green Space Coverage': random.uniform(10, 40),
                'Building Height': random.uniform(10, 50),
                'Traffic Flow': random.uniform(1000, 5000),
                'Air Quality': random.uniform(0, 200)
            }.get(indicator_name.replace('[SAMPLE] ', ''), 100)
            
            # Increase values for future projections
            year_factor = (state_year - 2023) / 10
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

        # Create sample indicator data
        for indicator in indicators:
            for state in states:
                data, created = IndicatorData.objects.get_or_create(
                    indicator=indicator,
                    state=state
                )
                
                if created:
                    # Add sample geojson data
                    IndicatorGeojson.objects.create(
                        indicatorData=data,
                        geojson=generate_sample_geojson(indicator.name, state.state_values['year'])
                    )
                    
                    # Add sample layer config
                    LayerConfig.objects.create(
                        indicatorData=data,
                        layer_config={
                            'opacity': 0.7,
                            'color': '#ff0000',
                            'fill': True
                        }
                    )
                    self.stdout.write(self.style.SUCCESS(f'Created data for {indicator.name} - {state.state_values["label"]}'))

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