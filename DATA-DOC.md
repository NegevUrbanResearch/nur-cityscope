# Data Documentation

This comprehensive guide explains data models, API endpoints, and management practices for the nur-CityScope application.

## Data Structure

The application uses the following data models:

1. **Map Types**
   - Purpose: Define different map visualization modes
   - Fields:
     - Name: Unique identifier for the map type
     - Description: Detailed explanation
     - Is Active: Whether this map type is currently available

2. **Indicators**
   - Purpose: Define measurable urban metrics
   - Fields:
     - Indicator ID: Unique numerical identifier
     - Name: Human-readable name
     - Has States: Whether this indicator has different states/scenarios
     - Description: Detailed explanation

3. **States (Present/Future)**
   - Purpose: Defines different time periods (projections or retrospective)
   - Fields:
     - State Values: JSON object containing:
       - Year: The year this state represents
       - Scenario: Type of scenario (current/projected)
       - Label: Human-readable label

4. **Indicator Data**
   - Purpose: Links indicators with their states
   - Fields:
     - Indicator: Reference to an indicator
     - State: Reference to a state

5. **Indicator GeoJSON**
   - Purpose: Stores geographic data for visualization
   - Fields:
     - Indicator Data: Reference to indicator data
     - GeoJSON: Geographic data in GeoJSON format

6. **Layer Config**
   - Purpose: Defines how layers are displayed
   - Fields:
     - Indicator Data: Reference to indicator data
     - Layer Config: JSON object containing:
       - Opacity
       - Color
       - Fill settings
       - Legend configuration

7. **Dashboard Feed State**
   - Purpose: Stores current dashboard metrics
   - Fields:
     - State: Reference to current state
     - Data: JSON object with current metrics

## API Documentation

### Interactive API Documentation

The application provides interactive API documentation through Swagger/OpenAPI:

1. **Swagger UI** - [http://localhost:9900/swagger/](http://localhost:9900/swagger/)
   - Interactive API explorer
   - Try out endpoints directly in the browser
   - See request/response formats

2. **ReDoc** - [http://localhost:9900/redoc/](http://localhost:9900/redoc/)
   - Clean, readable API reference
   - More user-friendly for browsing

3. **OpenAPI Schema** - [http://localhost:9900/swagger.json](http://localhost:9900/swagger.json)
   - Raw API schema in JSON format
   - Useful for integrations

### API Endpoints Overview

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

### Common API Request Examples

```bash
# List all indicators
curl http://localhost:9900/api/indicators/

# Create a new indicator
curl -X POST http://localhost:9900/api/indicators/ \
  -H "Content-Type: application/json" \
  -d '{"indicator_id": 4, "name": "New Indicator", "has_states": true, "description": "New description"}'

# Create a new state
curl -X POST http://localhost:9900/api/states/ \
  -H "Content-Type: application/json" \
  -d '{"state_values": {"year": 2024, "scenario": "projected", "label": "2024 Projection"}}'

# Create a new map type
curl -X POST http://localhost:9900/api/map_type/ \
  -H "Content-Type: application/json" \
  -d '{"name": "New Map Type", "description": "Description", "is_active": true}'
```

## Managing Data

### Through Admin Interface

1. Access the admin interface at [http://localhost:9900/admin](http://localhost:9900/admin)
2. Log in with your admin credentials
3. Select the data type you want to manage

#### Adding New Data:
1. Click the "Add" button next to the relevant model
2. Fill in the required fields
3. Click "Save"

#### Modifying Existing Data:
1. Click on the item you want to modify
2. Make your changes
3. Click "Save"

### Through Remote Controller

1. Access the remote controller at [http://localhost/remote/](http://localhost/remote/)
2. Use the interface to:
   - Toggle between different map types
   - Change states
   - Start/Stop the projection system

## Sample Data

The application includes sample data that demonstrates the system's capabilities:

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

To create fresh sample data:
```bash
docker exec -it core_api python manage.py shell < create_sample_data.py
```

To remove sample data, use the admin interface to delete items marked with [SAMPLE].

## Data Validation

When adding new data, ensure:

1. **GeoJSON Data**
   - Valid GeoJSON format
   - Coordinates in correct range
   - Required properties included
   - Reasonable value ranges

2. **Layer Configuration**
   - Valid color codes (hex format)
   - Opacity between 0 and 1
   - Proper legend configuration

3. **Dashboard Feed State**
   - All required metrics included
   - Values within reasonable ranges
   - Proper timestamp format

## Backup and Restore

### Creating a Backup
```bash
# Backup the database
docker exec core_db pg_dump -U postgres nur_db > backup.sql

# Backup uploaded files
docker cp core_api:/app/media/ ./backup/media/
```

### Restoring from Backup
```bash
# Restore the database
cat backup.sql | docker exec -i core_db psql -U postgres -d nur_db

# Restore uploaded files
docker cp ./backup/media/ core_api:/app/media/
```

## Troubleshooting

1. **Data Not Showing Up**
   - Check if the data is properly linked (Indicator → State → IndicatorData)
   - Verify GeoJSON format
   - Check layer configuration

2. **Invalid Data**
   - Use the admin interface to verify data integrity
   - Check API responses for error messages
   - Verify value ranges

3. **Performance Issues**
   - Optimize GeoJSON size
   - Use appropriate zoom levels
   - Consider caching strategies 