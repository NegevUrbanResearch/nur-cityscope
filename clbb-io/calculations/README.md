# CLBB-CityScope Data Processing

This directory contains the data processing pipeline for CLBB-CityScope. The system processes raw data into standardized formats required by the frontend visualization components.

## Required Output Formats

### 1. Spatial Data (GeoJSON)
- Location: `/app/data/processed/geojson/`
- Format: GeoJSON with standardized properties
- Required fields:
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
- Location: `/app/data/processed/indicators/`
- Format: JSON with standardized structure
- Required fields:
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
- Location: `/app/data/processed/dashboard/`
- Format: JSON with standardized structure
- Required fields:
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

1. **Raw Data Input**
   - Location: `/app/data/raw/`
   - Accepts various formats (CSV, Excel, GeoJSON, etc.)
   - Must include metadata about data source and timestamp

2. **Data Validation**
   - Schema validation for all input data
   - Data type checking
   - Required field verification
   - Spatial data validation

3. **Data Processing**
   - Spatial operations
   - Metric calculations
   - Aggregation by neighborhood
   - Time series processing

4. **Output Generation**
   - Standardized format conversion
   - Metadata enrichment
   - Quality checks

## Required Metrics

### 1. Density Metrics
- Population density
- Building density
- Amenity density
- Green space density

### 2. Proximity Metrics
- Distance to nearest amenities
- Access to public transport
- Walkability scores
- Bike network connectivity

### 3. Land Use Metrics
- Land use distribution
- Mixed-use indicators
- Development intensity

### 4. Environmental Metrics
- Green space coverage
- Tree canopy coverage
- Heat island effect
- Air quality indicators

### 5. Social Metrics
- Social infrastructure access
- Community facility coverage
- Public space quality

## Data Quality Requirements

1. **Completeness**
   - No missing values in required fields
   - Complete spatial coverage
   - Temporal consistency

2. **Accuracy**
   - Valid spatial geometries
   - Numeric values within expected ranges
   - Consistent units and scales

3. **Timeliness**
   - Regular updates
   - Clear update frequency
   - Version control

4. **Metadata**
   - Data source information
   - Processing methodology
   - Update history
   - Quality indicators 