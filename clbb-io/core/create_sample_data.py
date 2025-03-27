from backend.models import Indicator, State, IndicatorData, IndicatorGeojson, LayerConfig, DashboardFeedState

# Create sample indicators
indicators = [
    Indicator.objects.create(
        indicator_id=1,
        name='Population Density',
        has_states=True,
        description='Population density per square kilometer'
    ),
    Indicator.objects.create(
        indicator_id=2,
        name='Green Space Coverage',
        has_states=True,
        description='Percentage of green space in the area'
    ),
    Indicator.objects.create(
        indicator_id=3,
        name='Building Height',
        has_states=False,
        description='Average building height in meters'
    )
]

# Create sample states
states = [
    State.objects.create(state_values={'year': 2020, 'season': 'summer'}),
    State.objects.create(state_values={'year': 2020, 'season': 'winter'}),
    State.objects.create(state_values={'year': 2021, 'season': 'summer'})
]

# Create sample indicator data
for indicator in indicators:
    for state in states:
        data = IndicatorData.objects.create(
            indicator=indicator,
            state=state
        )
        
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

# Create sample dashboard feed state
DashboardFeedState.objects.create(
    state=states[0],
    data={
        'total_population': 1000000,
        'green_space_percentage': 25,
        'average_building_height': 15
    }
)

print('Sample data created successfully!') 