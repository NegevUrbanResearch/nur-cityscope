#!/bin/bash

echo "🔄 Resetting Docker containers and volumes..."
echo ""

# Stop all containers
echo "1️⃣  Stopping all containers..."
docker-compose down

# Remove volumes to clear database and media
echo "2️⃣  Removing volumes (this will delete the database and media files)..."
docker volume rm nur-cityscope_postgres_data_core nur-cityscope_media_files nur-cityscope_nur-api_data 2>/dev/null || echo "   (Some volumes may not exist, that's okay)"

# Remove the initialization flag from the data directory (if it exists locally)
echo "3️⃣  Removing initialization flags..."
rm -rf nur-io/django_api/data/db_initialized nur-io/django_api/data/assets_checksum 2>/dev/null || echo "   (Flags don't exist locally, that's okay)"

# Prune Docker system (optional but recommended)
echo "4️⃣  Pruning Docker system..."
docker system prune -f

echo ""
echo "✅ Reset complete!"
echo ""
echo "5️⃣  Rebuilding and starting containers..."
COMPOSE_BAKE=true docker-compose up --build -d

echo ""
echo "✅ All done! Containers are running in the background."
echo ""
echo "View logs with: docker-compose logs -f"
echo "Stop containers with: docker-compose down"
echo ""