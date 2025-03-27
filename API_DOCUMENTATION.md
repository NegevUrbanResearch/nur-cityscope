# CLBB-CityScope API Documentation

## Sample Data

The project includes sample data that demonstrates the system's capabilities. The sample data includes:

1. **Indicators**:
   - Population Density (with states)
   - Green Space Coverage (with states)
   - Building Height (without states)

2. **States**:
   - 2020 Summer
   - 2020 Winter
   - 2021 Summer

3. **Indicator Data**:
   - 9 entries (3 indicators × 3 states)
   - Each entry includes:
     - Associated indicator
     - Associated state
     - Sample GeoJSON data
     - Layer configuration

4. **Dashboard Feed State**:
   - Sample data for the current state including:
     - Total population
     - Green space percentage
     - Average building height

## API Endpoints

The application provides the following REST API endpoints:

1. **Indicators** (`/api/indicators/`)
   - GET: List all indicators
   - POST: Create a new indicator
   - GET `/{id}/`: Retrieve a specific indicator
   - PUT/PATCH `/{id}/`: Update an indicator
   - DELETE `/{id}/`: Delete an indicator

2. **States** (`/api/states/`)
   - GET: List all states
   - POST: Create a new state
   - GET `/{id}/`: Retrieve a specific state
   - PUT/PATCH `/{id}/`: Update a state
   - DELETE `/{id}/`: Delete a state

3. **Indicator Data** (`/api/indicator_data/`)
   - GET: List all indicator data entries
   - POST: Create new indicator data
   - GET `/{id}/`: Retrieve specific indicator data
   - PUT/PATCH `/{id}/`: Update indicator data
   - DELETE `/{id}/`: Delete indicator data

4. **Indicator Images** (`/api/indicator_images/`)
   - GET: List all indicator images
   - POST: Upload new indicator images
   - GET `/{id}/`: Retrieve a specific image
   - DELETE `/{id}/`: Delete an image

5. **Indicator GeoJSON** (`/api/indicator_geojson/`)
   - GET: List all GeoJSON data
   - POST: Create new GeoJSON data
   - GET `/{id}/`: Retrieve specific GeoJSON data
   - PUT/PATCH `/{id}/`: Update GeoJSON data
   - DELETE `/{id}/`: Delete GeoJSON data

6. **Dashboard Feed State** (`/api/dashboard_feed_state/`)
   - GET: Retrieve current dashboard state
   - POST: Update dashboard state
   - PUT/PATCH: Update dashboard state

7. **Layer Config** (`/api/layer_config/`)
   - GET: List all layer configurations
   - POST: Create new layer configuration
   - GET `/{id}/`: Retrieve specific layer configuration
   - PUT/PATCH `/{id}/`: Update layer configuration
   - DELETE `/{id}/`: Delete layer configuration

## API Features

All endpoints support:
- Pagination using `?page=<number>`
- Filtering using query parameters
- JSON response format
- Authentication (when configured)

## Example API Usage

```bash
# List all indicators
curl http://localhost:9900/api/indicators/

# Create a new indicator
curl -X POST http://localhost:9900/api/indicators/ \
  -H "Content-Type: application/json" \
  -d '{"indicator_id": 4, "name": "New Indicator", "has_states": true, "description": "New description"}'

# Get specific indicator data
curl http://localhost:9900/api/indicator_data/1/
```

## Database Management

### Checking Database Status
To check the status of your database tables and their contents:

```bash
# Show all migrations and their status
docker exec -it core_api python manage.py showmigrations backend

# Check the number of records in each table
docker exec -it core_api python manage.py shell -c "from backend.models import Indicator, State, IndicatorData; print(f'Indicators: {Indicator.objects.count()}\nStates: {State.objects.count()}\nIndicatorData: {IndicatorData.objects.count()}')"
```

### Updating the Database
If you need to update the database schema:

1. Make changes to your models in `clbb-io/core/backend/models.py`
2. Create new migrations:
```bash
docker exec -it core_api python manage.py makemigrations backend
```
3. Apply the migrations:
```bash
docker exec -it core_api python manage.py migrate backend
```

### Managing Data
You can manage data through:
1. The Django admin interface (http://localhost:9900/admin)
2. The API endpoints (http://localhost:9900/api/)
3. Django shell:
```bash
# Connect to Django shell
docker exec -it core_api python manage.py shell

# Example commands in the shell:
from backend.models import Indicator, State, IndicatorData

# Create a new indicator
indicator = Indicator.objects.create(
    indicator_id=1,
    name="Test Indicator",
    has_states=True,
    description="Test description"
)

# Create a new state
state = State.objects.create(state_values={"key": "value"})

# Create indicator data
indicator_data = IndicatorData.objects.create(
    indicator=indicator,
    state=state
)
```

### Backup and Restore
To backup the database:
```bash
# Backup
docker exec -it core_db pg_dump -U postgres clbb_db > backup.sql

# Restore
docker exec -i core_db psql -U postgres clbb_db < backup.sql
``` 