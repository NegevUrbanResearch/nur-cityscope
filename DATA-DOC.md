# Data Documentation

## Core Models

- **Table**: Higher-level container for organizing indicators by data source (for example, `idistrict`)
- **Indicator**: Measurable urban metrics (Mobility, Climate) - belongs to a Table
- **State**: Different scenarios/time periods for indicators
- **IndicatorData**: Links indicators with states
- **IndicatorImage**: Images for visualizations

### Table Parameter

**Important**: All API endpoints that query indicators by `indicator_id` require a `table` parameter. The table parameter identifies which data source the indicator belongs to. Existing data and indicators are associated with the `idistrict` table.

## API Endpoints

- `/api/tables/` - Table CRUD (filter by `?is_active=true/false`)
- `/api/indicators/` - Indicator CRUD (filter by `?table=<table_name>`)
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
