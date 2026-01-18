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

# Get local IP address
get_local_ip() {
    # Try different methods to get the local IP
    if command -v ip >/dev/null 2>&1; then
        ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' | grep -v "^$"
    elif command -v hostname >/dev/null 2>&1; then
        hostname -I 2>/dev/null | awk '{print $1}' | grep -v "^$"
    elif [ "$(uname)" = "Darwin" ]; then
        ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null
    fi
}

LOCAL_IP=$(get_local_ip)

echo "📍 Local access (localhost):"
echo "- Dashboard: http://localhost/dashboard/"
echo "- Projection: http://localhost/projection/"
echo "- Remote Controller: http://localhost/remote/"
echo "- OTEF Interactive: http://localhost/otef-interactive/"
echo "- OTEF Projection: http://localhost/otef-interactive/projection.html"
echo "- Admin Interface: http://localhost:9900/admin"

if [ -n "$LOCAL_IP" ]; then
    echo ""
    echo "🌐 Network access (from other devices):"
    echo "- Dashboard: http://$LOCAL_IP/dashboard/"
    echo "- Projection: http://$LOCAL_IP/projection/"
    echo "- Remote Controller: http://$LOCAL_IP/remote/"
    echo "- OTEF Interactive: http://$LOCAL_IP/otef-interactive/"
    echo "- OTEF Projection: http://$LOCAL_IP/otef-interactive/projection.html"
    echo "- Admin Interface: http://$LOCAL_IP:9900/admin"
else
    echo ""
    echo "⚠️  Could not detect local IP address for network access"
fi

echo ""
echo "View logs with: docker-compose logs -f"
echo "Stop containers with: docker-compose down"
echo ""