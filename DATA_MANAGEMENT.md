# Data Management Guide

This guide explains how to manage data in the CLBB-CityScope application.

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

## Managing Data

### Through Admin Interface

1. Access the admin interface at http://localhost:9900/admin
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

### Through API Endpoints

Base URL: http://localhost:9900/api/

1. **Map Types**
   ```bash
   # List all map types
   GET /api/map_type/
   
   # Create new map type
   POST /api/map_type/
   {
     "name": "New Map Type",
     "description": "Description",
     "is_active": true
   }
   ```

2. **Indicators**
   ```bash
   # List all indicators
   GET /api/indicators/
   
   # Create new indicator
   POST /api/indicators/
   {
     "indicator_id": 6,
     "name": "New Indicator",
     "has_states": true,
     "description": "Description"
   }
   ```

3. **States**
   ```bash
   # List all states
   GET /api/states/
   
   # Create new state
   POST /api/states/
   {
     "state_values": {
       "year": 2024,
       "scenario": "projected",
       "label": "2024 Projection"
     }
   }
   ```

### Through Remote Controller

1. Access the remote controller at http://localhost/remote/
2. Use the interface to:
   - Toggle between different map types
   - Change states
   - Start/Stop the projection system

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

## Sample Data

The application includes sample data (marked with [SAMPLE] prefix) that demonstrates:

1. Different types of indicators
2. Multiple states/scenarios
3. Various layer configurations
4. Example dashboard metrics

To create fresh sample data:
```bash
docker exec -it core_api python manage.py shell < create_sample_data.py
```

To remove sample data, use the admin interface to delete items marked with [SAMPLE].

## Backup and Restore

### Creating a Backup
```bash
# Backup the database
docker exec core_db pg_dump -U postgres clbb_db > backup.sql

# Backup uploaded files
docker cp core_api:/app/media/ ./backup/media/
```

### Restoring from Backup
```bash
# Restore the database
cat backup.sql | docker exec -i core_db psql -U postgres -d clbb_db

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

For additional info on the API, refer to [API_DOCUMENTATION.md](API_DOCUMENTATION.md) 