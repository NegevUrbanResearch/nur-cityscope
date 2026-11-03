#!/bin/bash
set -e

echo "Waiting for database..."
while ! nc -z db 5432; do
  sleep 0.1
done
echo "Database is ready!"

echo "Running database migrations..."
python manage.py migrate --no-input

echo "Setting up tables and indicators..."
python manage.py shell -c "
from backend.models import Table, Indicator

idistrict_table, _ = Table.objects.get_or_create(
    name='idistrict',
    defaults={'display_name': 'iDistrict', 'description': 'iDistrict data and indicators', 'is_active': True}
)

Indicator.objects.filter(table__isnull=True).update(table=idistrict_table)

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
    if indicator.name != name or indicator.category != category:
        indicator.name = name
        indicator.category = category
        indicator.has_states = True
        indicator.description = f'{name} indicators'
        indicator.save()
"

INIT_FLAG="/app/data/db_initialized"
if [ ! -f "$INIT_FLAG" ]; then
    echo "First time initialization..."
    python manage.py create_data

    python manage.py shell -c "
from django.contrib.auth.models import User
if not User.objects.filter(username='admin').exists():
    User.objects.create_superuser('admin', 'admin@example.com', 'admin123')
"

    mkdir -p "$(dirname "$INIT_FLAG")"
    touch "$INIT_FLAG"
fi

mkdir -p /app/media/indicators/processed
if [ -d "/app/public_idistrict/processed" ]; then
    echo "Copying idistrict mobility and climate to media..."
    [ -d "/app/public_idistrict/processed/mobility" ] && cp -rf /app/public_idistrict/processed/mobility /app/media/indicators/processed/
    [ -d "/app/public_idistrict/processed/climate" ] && cp -rf /app/public_idistrict/processed/climate /app/media/indicators/processed/
    echo "✓ Idistrict data copied to media/indicators/processed"
fi
chmod -R 755 /app/media

echo "Starting the server with Daphne (ASGI)..."
daphne -b 0.0.0.0 -p 9900 core.asgi:application
