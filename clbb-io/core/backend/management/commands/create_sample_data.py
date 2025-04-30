from django.core.management.base import BaseCommand
from backend.models import (
    Indicator, State, IndicatorData, IndicatorGeojson,
    LayerConfig, DashboardFeedState, MapType
)
import random
from datetime import datetime

class Command(BaseCommand):
    help = 'Creates sample data for the CLBB-CityScope application'

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

        # Create enhanced dashboard feed state with comprehensive data for all visualizations
        for state in states:
            # Calculate values with some randomness but based on the state year
            year_factor = (state.state_values['year'] - 2023) / 17  # Normalized factor (0 to 1)
            population_base = 800000 + random.uniform(-50000, 50000)
            population_value = population_base * (1 + year_factor * 0.4)
            green_space_base = 20 + random.uniform(-5, 5)
            green_space_value = min(45, green_space_base * (1 + year_factor * 0.5))
            building_height_base = 10 + random.uniform(-2, 2)
            building_height_value = building_height_base * (1 + year_factor * 0.7)
            
            # Create comprehensive data structure for all chart components
            dashboard_data = {
                # Basic metrics used by multiple charts
                'total_population': int(population_value),
                'green_space_percentage': float(f"{green_space_value:.2f}"),
                'average_building_height': float(f"{building_height_value:.2f}"),
                
                # Data for radar chart - standardized to English
                'radar': {
                    'categories': [
                        "Population_d", "Amenities_d", "Green_Space_d", 
                        "Proximity", "Land_Uses", "Mixed-Use", 
                        "Distance_d", "Building_d", "Walkability",
                        "Housing_d", "Proximity_Live", "Public_Space",
                        "Mobility"
                    ],
                    'valuesSet1': [
                        min(100, 45 + year_factor * 25 + random.uniform(-5, 5)),
                        min(100, 50 + year_factor * 20 + random.uniform(-5, 5)),
                        min(100, green_space_value * 2),
                        min(100, 65 + year_factor * 15 + random.uniform(-3, 3)),
                        min(100, 70 + year_factor * 10 + random.uniform(-3, 3)),
                        min(100, 55 + year_factor * 20 + random.uniform(-5, 5)),
                        min(100, 60 + year_factor * 15 + random.uniform(-4, 4)),
                        min(100, building_height_value + 40 + random.uniform(-5, 5)),
                        min(100, 65 + year_factor * 15 + random.uniform(-5, 5)),
                        min(100, 40 + year_factor * 20 + random.uniform(-5, 5)),
                        min(100, 60 + year_factor * 15 + random.uniform(-5, 5)),
                        min(100, 50 + year_factor * 20 + random.uniform(-5, 5)),
                        min(100, 45 + year_factor * 25 + random.uniform(-5, 5))
                    ],
                    'valuesSet2': [
                        92.37, 45.02, 87.30, 69.87, 79.30, 88.09,
                        79.17, 59.10, 91.54, 7.50, 43.00, 47.17, 55.00
                    ]
                },
                
                # Data for horizontal stacked bar chart - standardized to English
                'horizontalStackedBar': {
                    'bars': [
                        {"name": "Proximity", "values": [45, 35, 20]},
                        {"name": "Density", "values": [30, 40, 30]},
                        {"name": "Mixed-Use", "values": [25, 35, 40]}
                    ]
                },
                
                # Data for stacked bar chart - standardized to English
                'stackedBar': {
                    'bars': [
                        {"name": "Population", "values": [min(100, (population_value / 20000)), 100 - min(100, (population_value / 20000))]},
                        {"name": "Buildings", "values": [min(100, building_height_value + 30), 100 - min(100, building_height_value + 30)]},
                        {"name": "Amenities", "values": [min(100, 50 + year_factor * 20), 100 - min(100, 50 + year_factor * 20)]}
                    ]
                },
                
                # Data for traffic light table - standardized to English
                'trafficLight': [
                    {"name": "Walkability", "value": min(100, 70 + year_factor * 15 + random.uniform(-5, 5))},
                    {"name": "Public Transport", "value": min(100, 50 + year_factor * 25 + random.uniform(-5, 5))},
                    {"name": "Green Space", "value": min(100, green_space_value * 1.5 + random.uniform(-3, 3))}
                ],
                
                # Data for regular table component - standardized to English
                'table': {
                    "indicators": ["Population", "Buildings", "Amenities"],
                    "districts": [
                        {
                            "name": "District A",
                            "values": [
                                min(100, (population_value / 20000) + random.uniform(-5, 5)),
                                min(100, building_height_value + 30 + random.uniform(-3, 3)),
                                min(100, 50 + year_factor * 20 + random.uniform(-5, 5))
                            ]
                        },
                        {
                            "name": "District B",
                            "values": [
                                min(100, (population_value / 20000) * 0.7 + random.uniform(-3, 3)),
                                min(100, (building_height_value + 30) * 0.8 + random.uniform(-3, 3)),
                                min(100, (50 + year_factor * 20) * 0.9 + random.uniform(-3, 3))
                            ]
                        }
                    ]
                },
                
                # Data for data table with progress bars - standardized to English
                'dataTable': {
                    "categories": [
                        {
                            "name": "Walkability",
                            "indicators": {
                                "value1": min(100, 70 + year_factor * 15 + random.uniform(-5, 5)),
                                "value2": min(100, 60 + year_factor * 20 + random.uniform(-5, 5))
                            }
                        },
                        {
                            "name": "Accessibility",
                            "indicators": {
                                "value1": min(100, 50 + year_factor * 25 + random.uniform(-5, 5)),
                                "value2": min(100, 45 + year_factor * 30 + random.uniform(-5, 5))
                            }
                        }
                    ]
                }
            }
            
            # Create or update dashboard feed state for this state
            feed_state, created = DashboardFeedState.objects.update_or_create(
                state=state,
                defaults={'data': dashboard_data}
            )
            
            status = 'Created' if created else 'Updated'
            self.stdout.write(self.style.SUCCESS(f'{status} dashboard feed state for {state.state_values["label"]}'))

        self.stdout.write(self.style.SUCCESS('Sample data created successfully!')) 