#!/bin/bash
set -e

# Wait for database to be ready
echo "Waiting for database..."
while ! nc -z db 5432; do
  sleep 0.1
done
echo "Database is ready!"

# Add code to ensure media directories exist and have proper permissions
mkdir -p /app/media/indicators
mkdir -p /app/media/maps

# Ensure proper permissions for media directories
chmod -R 775 /app/media
chown -R root:root /app/media

# Set up subdirectories for indicators by category
mkdir -p /app/media/indicators/mobility
mkdir -p /app/media/indicators/climate

# Set permissions for all media subdirectories
chmod -R 775 /app/media/indicators

# Check if this is first-time initialization
INIT_FLAG="/app/data/db_initialized"
if [ ! -f "$INIT_FLAG" ]; then
    echo "First time initialization..."
    
    # Force reset the database schema by dropping all tables
    echo "Resetting database schema..."
    cat <<EOF | python -c "
import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
import django
django.setup()
from django.db import connection
cursor = connection.cursor()
cursor.execute(\"\"\"
  DO \$\$
  DECLARE
    r RECORD;
  BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename != 'django_migrations') LOOP
      EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
  END \$\$;
\"\"\")
print('All tables dropped!')
"
EOF

    # Run the migrations fresh
    echo "Running database migrations..."
    python manage.py migrate --no-input

    # Create data (loads real data from public/ if available)
    echo "Generating data..."
    python manage.py create_data || echo "No create_data command available, skipping..."
    
    # Create default admin user if it doesn't exist
    echo "Creating default admin user..."
    python manage.py shell -c "from django.contrib.auth.models import User; User.objects.create_superuser('admin', 'admin@example.com', 'admin123') if not User.objects.filter(username='admin').exists() else None"
    
    # Create initialization flag
    mkdir -p "$(dirname "$INIT_FLAG")"
    touch "$INIT_FLAG"
else
    echo "Database already initialized, skipping schema reset."
    
    # Run migrations to apply any new changes without resetting
    echo "Running database migrations for updates..."
    python manage.py migrate --no-input
fi

# Check if we need to process data
if [ ! -f /app/data/processed/indicators/* ] && [ "${USE_SAMPLE_DATA:-true}" = "true" ]; then
    echo "No processed data found. Processing data..."
    python -c "from websocket_app.utils.data_manager import data_manager; import asyncio; asyncio.run(data_manager.process_all())"
else
    echo "Using existing data..."
fi

# Near the end of the file, before starting the server
# Ensure media directories exist and have proper permissions
echo "Setting up media directories..."
mkdir -p /app/media/indicators/mobility
mkdir -p /app/media/indicators/climate
mkdir -p /app/media/maps

# Set permissions to ensure nginx can read these files
echo "Setting permissions for media files..."
find /app/media -type d -exec chmod 755 {} \;
find /app/media -type f -exec chmod 644 {} \;

# Verify directories exist and have correct permissions
echo "Verifying media directory setup..."
for dir in "/app/media" "/app/media/indicators" "/app/media/indicators/mobility" "/app/media/indicators/climate" "/app/media/maps"; do
    if [ ! -d "$dir" ]; then
        echo "ERROR: Directory $dir does not exist!"
        exit 1
    fi
    
    # Check permissions (should be at least 755 for directories)
    perm=$(stat -c "%a" "$dir")
    if [ "$perm" -lt "755" ]; then
        echo "WARNING: Directory $dir has insufficient permissions: $perm, fixing..."
        chmod 755 "$dir"
    fi
done

echo "Media directories properly configured."

# Start the server
echo "Starting the server..."
python manage.py runserver 0.0.0.0:9900
