#!/bin/bash
set -e

# Wait for database to be ready
echo "Waiting for database to be ready..."
while ! python -c "import psycopg2; psycopg2.connect('dbname=postgres user=postgres password=postgres host=db port=5432')" 2>/dev/null; do
    sleep 1
done
echo "Database is ready!"

# Run migrations
echo "Running migrations..."
python manage.py migrate

# Check if this is first-time initialization
INIT_FLAG="/app/data/db_initialized"
if [ ! -f "$INIT_FLAG" ]; then
    echo "First time initialization..."
    
    # Clean up existing data
    echo "Cleaning up existing data..."
    python manage.py shell -c "
from backend.models import *
DashboardFeedState.objects.all().delete()
Indicator.objects.all().delete()
State.objects.all().delete()
IndicatorData.objects.all().delete()
IndicatorGeoJSON.objects.all().delete()
LayerConfig.objects.all().delete()
MapType.objects.all().delete()
    "
    
    # Create sample data
    echo "Creating sample data..."
    python manage.py create_sample_data
    
    # Create default admin user if it doesn't exist
    echo "Creating default admin user..."
    python manage.py shell -c "
from django.contrib.auth.models import User
if not User.objects.filter(username='admin').exists():
    User.objects.create_superuser('admin', 'admin@example.com', 'admin123')
    "
    
    # Create initialization flag
    mkdir -p /app/data
    touch "$INIT_FLAG"
fi

# Start the server
echo "Starting server..."
python manage.py runserver 0.0.0.0:9900
