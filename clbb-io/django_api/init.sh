#!/bin/bash
set -e

# Wait for database to be ready
echo "Waiting for database..."
while ! nc -z db 5432; do
  sleep 0.1
done
echo "Database is ready!"

# Run migrations
echo "Running database migrations..."
python manage.py migrate

# Check if this is first-time initialization
INIT_FLAG="/app/data/db_initialized"
if [ ! -f "$INIT_FLAG" ]; then
    echo "First time initialization..."
    
    # Clean up existing data
    echo "Cleaning up existing data..."
    python manage.py shell -c "from backend.models import *; DashboardFeedState.objects.all().delete(); Indicator.objects.all().delete(); State.objects.all().delete(); IndicatorData.objects.all().delete(); IndicatorGeoJSON.objects.all().delete(); LayerConfig.objects.all().delete(); MapType.objects.all().delete()"
    
    # Create default admin user if it doesn't exist
    echo "Creating default admin user..."
    python manage.py shell -c "from django.contrib.auth.models import User; User.objects.create_superuser('admin', 'admin@example.com', 'admin123') if not User.objects.filter(username='admin').exists() else None"
    
    # Create initialization flag
    mkdir -p "$(dirname "$INIT_FLAG")"
    touch "$INIT_FLAG"
fi

# Check if we need to process data
if [ ! -f /app/data/processed/indicators/* ] && [ "${USE_SAMPLE_DATA:-true}" = "true" ]; then
    echo "No processed data found. Processing data..."
    python -c "from websocket_app.utils.data_manager import data_manager; import asyncio; asyncio.run(data_manager.process_all())"
else
    echo "Using existing data..."
fi

# Start the server
echo "Starting server..."
python manage.py runserver 0.0.0.0:9900
