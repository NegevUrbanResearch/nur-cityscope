# Data Documentation

## Core Models

- **Indicator**: Measurable urban metrics (Mobility, Climate, Land Use)
- **State**: Different scenarios/time periods for indicators
- **IndicatorData**: Links indicators with states
- **IndicatorImage**: Images for visualizations

## API Endpoints

- `/api/indicators/` - Indicator CRUD
- `/api/states/` - State CRUD
- `/api/indicator_data/` - Indicator data CRUD
- `/api/indicator_images/` - Image upload/management
- `/api/actions/set_climate_scenario/` - Set climate scenario (POST: `{scenario, type}`)
- `/api/actions/get_image_data/` - Get current visualization image

## Admin Interface

Django admin: [http://localhost:9900/admin](http://localhost:9900/admin)

## Climate Scenarios

7 scenarios × 2 types (UTCI/Plan) = 14 states:

- Existing, Dense Highrise, High Rises, Low Rise Dense, Mass Tree Planting, Open Public Space, Placemaking

## Migration

```bash
# Run migrations
python manage.py migrate

# Import climate images
python manage.py import_climate_images
```
