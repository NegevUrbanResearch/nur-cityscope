#!/bin/bash

# Wait for the database to be ready
echo "Waiting for database to be ready..."
while ! nc -z db 5432; do
  sleep 0.1
done
echo "Database is ready!"

# Run migrations
echo "Running database migrations..."
python manage.py makemigrations backend
python manage.py migrate backend
python manage.py migrate  # Run all migrations

# Check if this is the first run
INIT_FLAG="/app/data/db_initialized"
mkdir -p /app/data

if [ ! -f "$INIT_FLAG" ]; then
    echo "First time initialization detected..."
    
    # Clean up existing data
    echo "Cleaning up existing data..."
    python manage.py shell -c "from backend.models import Indicator, State, IndicatorData, IndicatorGeojson, LayerConfig, DashboardFeedState; DashboardFeedState.objects.all().delete(); LayerConfig.objects.all().delete(); IndicatorGeojson.objects.all().delete(); IndicatorData.objects.all().delete(); State.objects.all().delete(); Indicator.objects.all().delete();"

    # Create sample data
    echo "Creating sample data..."
    python manage.py shell -c "exec(open('/app/create_sample_data.py').read())"

    # Create default admin user if it doesn't exist
    echo "Creating default admin user..."
    python manage.py shell -c "from django.contrib.auth.models import User; User.objects.create_superuser('admin', 'admin@example.com', 'admin123') if not User.objects.filter(username='admin').exists() else None;"

    # Create flag file to indicate initialization is done
    touch "$INIT_FLAG"
    echo "First time initialization completed."
else
    echo "Database already initialized, skipping first-time setup."
fi

# Start the server
echo "Starting the server..."
python manage.py runserver 0.0.0.0:9900 