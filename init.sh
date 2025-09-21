#!/bin/bash

# Exit on error
set -e

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

# Check if this is the first run or if assets have been updated
INIT_FLAG="/app/data/db_initialized"
ASSETS_CHECKSUM_FILE="/app/data/assets_checksum"
mkdir -p /app/data

# Calculate checksum of all assets in public/processed to detect changes
if [ -d "/app/public/processed" ]; then
    CURRENT_CHECKSUM=$(find /app/public/processed -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" -o -name "*.gif" -o -name "*.svg" -o -name "*.html" -o -name "*.json" \) -exec stat -c "%Y %s %n" {} \; | sort | sha256sum | cut -d' ' -f1)
else
    CURRENT_CHECKSUM="no_assets"
fi

# Check if we need to initialize/update data
NEED_INIT=false
if [ ! -f "$INIT_FLAG" ]; then
    echo "First time initialization detected..."
    NEED_INIT=true
elif [ ! -f "$ASSETS_CHECKSUM_FILE" ] || [ "$(cat $ASSETS_CHECKSUM_FILE 2>/dev/null)" != "$CURRENT_CHECKSUM" ]; then
    echo "Asset changes detected, updating data..."
    NEED_INIT=true
else
    echo "Database already initialized and assets unchanged, skipping data recreation."
fi

if [ "$NEED_INIT" = true ]; then
    # Clean up existing data
    echo "Cleaning up existing data..."
    python manage.py shell -c "from backend.models import Indicator, State, IndicatorData, IndicatorGeojson, LayerConfig, DashboardFeedState, IndicatorImage; IndicatorImage.objects.all().delete(); DashboardFeedState.objects.all().delete(); LayerConfig.objects.all().delete(); IndicatorGeojson.objects.all().delete(); IndicatorData.objects.all().delete(); State.objects.all().delete(); Indicator.objects.all().delete();"

    # Create sample data
    echo "Creating sample data..."
    python manage.py create_sample_data

    # Create default admin user if it doesn't exist
    echo "Creating default admin user..."
    python manage.py shell -c "from django.contrib.auth.models import User; User.objects.create_superuser('admin', 'admin@example.com', 'admin123') if not User.objects.filter(username='admin').exists() else None;"

    # Save current assets checksum and create flag file
    echo "$CURRENT_CHECKSUM" > "$ASSETS_CHECKSUM_FILE"
    touch "$INIT_FLAG"
    echo "Database initialization/update completed."
fi

# Start the server
echo "Starting the server..."
python manage.py runserver 0.0.0.0:9900 