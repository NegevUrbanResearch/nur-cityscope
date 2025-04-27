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