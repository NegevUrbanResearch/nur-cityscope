#!/bin/bash

# === CLBB-CityScope Setup Script ===
# This script sets up the CLBB-CityScope project using Docker.

# Determine script directory (works regardless of where the script is called from)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Navigate to script directory
cd "$SCRIPT_DIR" || exit

# Create necessary migration folders
echo "Creating required migration folders..."
mkdir -p "$SCRIPT_DIR/clbb-io/core/external_files"
mkdir -p "$SCRIPT_DIR/clbb-io/core/migrations"
mkdir -p "$SCRIPT_DIR/clbb-io/backend/migrations"

# Create empty __init__.py files
touch "$SCRIPT_DIR/clbb-io/core/migrations/__init__.py"
touch "$SCRIPT_DIR/clbb-io/backend/migrations/__init__.py"

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

