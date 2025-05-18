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

# Ensure logo files are present in all required locations
echo "Ensuring logo files are in place..."
mkdir -p "$SCRIPT_DIR/nur-io/django_api/media"
mkdir -p "$SCRIPT_DIR/nur-front/frontend/public/media"

# Copy logo if it exists in any location
if [ -f "$SCRIPT_DIR/nur-front/frontend/public/Nur-Logo_3x-_1_.svg" ]; then
  cp "$SCRIPT_DIR/nur-front/frontend/public/Nur-Logo_3x-_1_.svg" "$SCRIPT_DIR/nur-io/django_api/media/"
  cp "$SCRIPT_DIR/nur-front/frontend/public/Nur-Logo_3x-_1_.svg" "$SCRIPT_DIR/nur-front/frontend/public/media/"
elif [ -f "$SCRIPT_DIR/nur-front/frontend/public/media/Nur-Logo_3x-_1_.svg" ]; then
  cp "$SCRIPT_DIR/nur-front/frontend/public/media/Nur-Logo_3x-_1_.svg" "$SCRIPT_DIR/nur-io/django_api/media/"
elif [ -f "$SCRIPT_DIR/nur-io/django_api/media/Nur-Logo_3x-_1_.svg" ]; then
  cp "$SCRIPT_DIR/nur-io/django_api/media/Nur-Logo_3x-_1_.svg" "$SCRIPT_DIR/nur-front/frontend/public/media/"
  cp "$SCRIPT_DIR/nur-io/django_api/media/Nur-Logo_3x-_1_.svg" "$SCRIPT_DIR/nur-front/frontend/public/"
fi

# Create the Docker network if it doesn't exist
echo "Creating Docker network if it doesn't exist..."
docker network create nur_core 2>/dev/null || true

# Start the services
echo "Starting services..."
docker-compose up -d

# Wait for services to be ready
echo "Waiting for services to be ready..."
sleep 10

# Run migrations
echo "Running database migrations..."
docker exec core_api python manage.py migrate

# Create sample data
echo "Creating sample data..."
docker exec core_api python manage.py create_sample_data

echo "✅ All services have been successfully configured and sample data has been created."
echo "You can now access:"
echo "- Dashboard: http://localhost/dashboard/"
echo "- Projection: http://localhost/projection/"
echo "- Remote Controller: http://localhost/remote/"
echo "- Admin Interface: http://localhost:9900/admin"

