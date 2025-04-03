# Data Requirements Documentation

This document outlines the data requirements, file organization, and validation rules for the CLBB-CityScope system.

## System Architecture

### Directory Structure
```
clbb-io/
├── calculations/              # Data processing modules
│   ├── modules/              # Processing implementations
│   │   └── base.py          # Base processor class
│   └── README.md            # Processing documentation
├── core/                     # Main Django application
│   ├── backend/             # Django models and views
│   │   ├── models.py        # Database models
│   │   ├── views.py         # API endpoints
│   │   └── urls.py          # URL routing
│   ├── core/                # Django project settings
│   ├── data/                # Data storage
│   ├── external_files/      # External data sources
│   ├── management/          # Django management commands
│   ├── media/              # User-uploaded files
│   ├── migrations/         # Database migrations
│   └── websocket_app/      # Real-time updates
```

## Data Flow

### 1. Data Input
- Raw data files in `/data/raw/`
- External data sources in `/external_files/`
- User uploads in `/media/`

### 2. Data Processing
- Processing modules in `/calculations/modules/`
- Base processor in `base.py`
- Validation rules in `/data/validation/`

### 3. Data Output
- Processed data in `/data/processed/`
- Real-time updates via WebSocket
- API endpoints in `/backend/views.py`

## Data Types and Formats

### 1. Spatial Data (GeoJSON)
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {...},
      "properties": {
        "id": "string",
        "name": "string",
        "type": "string",
        "value": "number",
        "category": "string",
        "timestamp": "string (ISO format)"
      }
    }
  ]
}
```

### 2. Indicator Data
```json
{
  "indicator_id": "string",
  "name": "string",
  "description": "string",
  "unit": "string",
  "values": {
    "neighborhood_id": {
      "value": "number",
      "timestamp": "string (ISO format)",
      "metadata": {}
    }
  }
}
```

### 3. Dashboard Data
```json
{
  "dashboard_id": "string",
  "title": "string",
  "description": "string",
  "charts": [
    {
      "type": "radar|bar|pie|horizontal_stacked_bar",
      "data": {
        "categories": ["string"],
        "valuesSet1": ["number"],
        "valuesSet2": ["number"],
        "labels": ["string"]
      }
    }
  ]
}
```

## Data Processing Pipeline

### 1. Input Validation
```python
def validate_input_data(data: Any, schema: Dict) -> bool:
    """Validate input data against schema."""
    # Implementation in base.py
```

### 2. Data Processing
```python
def process_spatial_data(data: gpd.GeoDataFrame) -> Dict:
    """Process spatial data into GeoJSON."""
    # Implementation in base.py

def process_indicator_data(data: pd.DataFrame) -> Dict:
    """Process indicator data."""
    # Implementation in base.py

def process_dashboard_data(data: Dict) -> Dict:
    """Process dashboard data."""
    # Implementation in base.py
```

### 3. Output Generation
```python
def save_processed_data(data: Dict, data_type: str, filename: str):
    """Save processed data to appropriate directory."""
    # Implementation in base.py
```

## Real-time Updates

### WebSocket Communication
```python
# data_updater.py
class DataUpdater:
    async def get_indicator(self, indicator_id: int, state: int):
        """Get indicator data for real-time updates."""
        # Implementation

    async def get_indicator_data(self, indicator_id: int, state: int):
        """Get detailed indicator data."""
        # Implementation
```

### Data Manager
```python
# data_manager.py
class DataManager:
    async def handle_update(self, event_data: Dict):
        """Handle real-time data updates."""
        # Implementation
```

## Database Models

### Core Models
```python
class Indicator(models.Model):
    """Indicator definition."""
    # Implementation in models.py

class State(models.Model):
    """State definition."""
    # Implementation in models.py

class IndicatorData(models.Model):
    """Indicator data."""
    # Implementation in models.py
```

## Validation Rules

### 1. Data Completeness
- All required fields must be present
- No missing values in critical fields
- Complete spatial coverage

### 2. Data Types
- Correct data types for all fields
- Valid numeric ranges
- Proper string formats

### 3. Spatial Validation
- Valid GeoJSON structure
- Proper coordinate systems
- Valid geometries

### 4. Temporal Validation
- Valid timestamps
- Consistent time zones
- Proper date ranges

## Error Handling

### 1. Input Errors
- Missing files
- Invalid formats
- Corrupted data

### 2. Processing Errors
- Calculation failures
- Validation failures
- Transformation errors

### 3. Output Errors
- Save failures
- Database errors
- WebSocket disconnections

## Testing

### 1. Unit Tests
```python
# tests.py
class DataValidationTests(TestCase):
    """Test data validation."""
    # Implementation

class DataProcessingTests(TestCase):
    """Test data processing."""
    # Implementation
```

### 2. Integration Tests
```python
class WebSocketTests(TestCase):
    """Test WebSocket communication."""
    # Implementation

class APITests(TestCase):
    """Test API endpoints."""
    # Implementation
```

## Deployment

### Docker Setup
```dockerfile
# Dockerfile
FROM python:3.9-slim
# Implementation
```

### Environment Variables
```env
# .env
DEBUG=True
DATABASE_URL=postgresql://postgres:postgres@db:5432/clbb
# Other variables
```

## Monitoring

### Logging
```python
# Logging configuration
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
```

### Performance Metrics
- Processing time
- Memory usage
- Database queries
- WebSocket connections 