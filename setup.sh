#!/bin/bash

# === nur-CityScope Setup Script ===
# This script sets up the nur-CityScope project using Docker.

# Determine script directory (works regardless of where the script is called from)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Navigate to script directory
cd "$SCRIPT_DIR" || exit

# Create necessary migration folders
echo "Creating required migration folders..."
mkdir -p "$SCRIPT_DIR/nur-io/core/external_files"
mkdir -p "$SCRIPT_DIR/nur-io/core/migrations"
mkdir -p "$SCRIPT_DIR/nur-io/backend/migrations"

# Create empty __init__.py files
touch "$SCRIPT_DIR/nur-io/core/migrations/__init__.py"
touch "$SCRIPT_DIR/nur-io/backend/migrations/__init__.py"

# Copy logo to required locations
echo "Ensuring logo files are in place..."
mkdir -p "$SCRIPT_DIR/nur-io/django_api/media"
mkdir -p "$SCRIPT_DIR/nur-front/frontend/public/media"
cp "$SCRIPT_DIR/nur-front/frontend/public/Nur-Logo_3x-_1_.svg" "$SCRIPT_DIR/nur-io/django_api/media/"
cp "$SCRIPT_DIR/nur-front/frontend/public/Nur-Logo_3x-_1_.svg" "$SCRIPT_DIR/nur-front/frontend/public/media/"

# Create the Docker network if it doesn't exist
echo "Creating Docker network if it doesn't exist..."
docker network create nur_core 2>/dev/null || true

# Start the services
echo "Starting services..."
COMPOSE_BAKE=true docker-compose up -d

# Wait for services to be ready
echo "Waiting for services to be ready..."
sleep 10

# Copy logo file into nginx container
echo "Ensuring logo is accessible in nginx container..."
docker cp "$SCRIPT_DIR/nur-front/frontend/public/Nur-Logo_3x-_1_.svg" nginx-front:/usr/share/nginx/html/media/

# Setup OTEF Interactive module (simplified layers are auto-generated if missing)
if [ ! -f "$SCRIPT_DIR/otef-interactive/public/import/layers/migrashim_simplified.json" ]; then
    echo "Generating simplified GeoJSON layers for OTEF..."
    python3 "$SCRIPT_DIR/otef-interactive/scripts/simplify_geometries.py"
fi

# Run migrations
echo "Running database migrations..."
docker exec nur-api python manage.py migrate

# Create data (loads real data from public/)
echo "Creating data structure..."
docker exec nur-api python manage.py create_data

echo "✅ All services have been successfully configured and data has been loaded."
echo "You can now access:"
echo "- Dashboard: http://localhost/dashboard/"
echo "- Projection: http://localhost/projection/"
echo "- Remote Controller: http://localhost/remote/"
echo "- OTEF Interactive: http://localhost/otef-interactive/"
echo "- OTEF Projection: http://localhost/otef-interactive/projection.html"
echo "- Admin Interface: http://localhost:9900/admin"

