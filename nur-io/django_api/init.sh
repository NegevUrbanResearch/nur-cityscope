#!/bin/bash
set -e

# Wait for database to be ready
echo "Waiting for database..."
while ! nc -z db 5432; do
  sleep 0.1
done
echo "Database is ready!"

# Create migrations for any model changes
echo "Creating database migrations..."
python manage.py makemigrations --no-input || true

# Run migrations
echo "Running database migrations..."
python manage.py migrate --no-input

# Setup tables and indicators
echo "Setting up tables and indicators..."
python manage.py shell -c "
from backend.models import Table, Indicator

# Create tables
otef_table, _ = Table.objects.get_or_create(
    name='otef',
    defaults={'display_name': 'OTEF', 'description': 'OTEF Interactive Projection Module data', 'is_active': True}
)

idistrict_table, _ = Table.objects.get_or_create(
    name='idistrict',
    defaults={'display_name': 'iDistrict', 'description': 'iDistrict data and indicators', 'is_active': True}
)

# Fix any orphaned indicators
Indicator.objects.filter(table__isnull=True).update(table=idistrict_table)

# Create/update indicators for idistrict
for indicator_id, name, category in [(1, 'Mobility', 'mobility'), (2, 'Climate', 'climate')]:
    indicator, _ = Indicator.objects.get_or_create(
        table=idistrict_table,
        indicator_id=indicator_id,
        defaults={
            'name': name,
            'category': category,
            'has_states': True,
            'description': f'{name} indicators'
        }
    )
    # Update if exists
    if indicator.name != name or indicator.category != category:
        indicator.name = name
        indicator.category = category
        indicator.has_states = True
        indicator.description = f'{name} indicators'
        indicator.save()
"

# Create data on first init only
INIT_FLAG="/app/data/db_initialized"
if [ ! -f "$INIT_FLAG" ]; then
    echo "First time initialization..."
    python manage.py create_data

    # Import OTEF data (layers and model config)
    echo "Importing OTEF GIS layers and model config..."
    python manage.py import_otef_data || echo "Warning: OTEF data import failed (files may not exist yet)"

    # Create default admin user
    python manage.py shell -c "
from django.contrib.auth.models import User
if not User.objects.filter(username='admin').exists():
    User.objects.create_superuser('admin', 'admin@example.com', 'admin123')
"

    mkdir -p "$(dirname "$INIT_FLAG")"
    touch "$INIT_FLAG"
fi

# Always try to import/update OTEF data (idempotent - won't duplicate)
echo "Updating OTEF data (if available)..."
python manage.py import_otef_data || echo "Note: OTEF data files not found or already up to date"

# Note: Layer processing (coord conversion, PMTiles, .lyrx parsing) happens
# during setup/reset scripts, not at container runtime. Processed outputs
# should already exist in /app/public/processed/layers/ before container starts.

# Setup media directories and copy files from public/processed
mkdir -p /app/media/indicators/processed
if [ -d "/app/public/processed" ]; then
    echo "Copying processed files from public (OTEF) to media..."
    cp -rf /app/public/processed/* /app/media/indicators/processed/ 2>/dev/null || true
fi
if [ -d "/app/public_idistrict/processed" ]; then
    echo "Copying idistrict mobility and climate to media..."
    [ -d "/app/public_idistrict/processed/mobility" ] && cp -rf /app/public_idistrict/processed/mobility /app/media/indicators/processed/
    [ -d "/app/public_idistrict/processed/climate" ] && cp -rf /app/public_idistrict/processed/climate /app/media/indicators/processed/
    echo "✓ Idistrict data copied to media/indicators/processed"
fi
chmod -R 755 /app/media

# Start the server with Daphne (ASGI) for WebSocket support
echo "Starting the server with Daphne (ASGI)..."
daphne -b 0.0.0.0 -p 9900 core.asgi:application
