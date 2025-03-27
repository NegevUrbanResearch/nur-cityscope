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

        # Create sample dashboard feed state
        feed_state, created = DashboardFeedState.objects.get_or_create(
            state=states[0],
            defaults={
                'data': {
                    'total_population': 1000000,
                    'green_space_percentage': 25,
                    'average_building_height': 15
                }
            }
        )
        if created:
            self.stdout.write(self.style.SUCCESS('Created dashboard feed state'))

        self.stdout.write(self.style.SUCCESS('Sample data created successfully!')) 