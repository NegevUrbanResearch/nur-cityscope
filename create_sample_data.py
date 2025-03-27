from backend.models import Indicator, State, IndicatorData, IndicatorGeojson, LayerConfig, DashboardFeedState

# Create sample indicators if they don't exist
indicators = []
sample_indicators = [
    {
        'indicator_id': 1,
        'name': 'Population Density',
        'has_states': True,
        'description': 'Population density per square kilometer'
    },
    {
        'indicator_id': 2,
        'name': 'Green Space Coverage',
        'has_states': True,
        'description': 'Percentage of green space in the area'
    },
    {
        'indicator_id': 3,
        'name': 'Building Height',
        'has_states': False,
        'description': 'Average building height in meters'
    }
]

for indicator_data in sample_indicators:
    indicator, created = Indicator.objects.get_or_create(
        indicator_id=indicator_data['indicator_id'],
        defaults=indicator_data
    )
    indicators.append(indicator)

# Create sample states if they don't exist
states = []
sample_states = [
    {'year': 2020, 'season': 'summer'},
    {'year': 2020, 'season': 'winter'},
    {'year': 2021, 'season': 'summer'}
]

for state_data in sample_states:
    state, created = State.objects.get_or_create(
        state_values=state_data
    )
    states.append(state)

# Create sample indicator data if it doesn't exist
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
                geojson={
                    'type': 'FeatureCollection',
                    'features': [{
                        'type': 'Feature',
                        'properties': {'value': 100},
                        'geometry': {
                            'type': 'Polygon',
                            'coordinates': [[[0,0], [0,1], [1,1], [1,0], [0,0]]]
                        }
                    }]
                }
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

# Create sample dashboard feed state if it doesn't exist
DashboardFeedState.objects.get_or_create(
    state=states[0],
    defaults={
        'data': {
            'total_population': 1000000,
            'green_space_percentage': 25,
            'average_building_height': 15
        }
    }
)

print('Sample data created successfully!') 