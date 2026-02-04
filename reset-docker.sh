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

# Prune unused Docker images only (keeps all containers, including unrelated ones like n8n)
echo "4️⃣  Pruning unused Docker images (containers will be kept)..."
docker image prune -f

echo ""
echo "✅ Reset complete!"
echo ""

# Process layer packs (before starting containers)
echo "5️⃣  Setting up OTEF layer packs..."

VENV_PATH="otef-interactive/scripts/.venv"
if [ ! -d "$VENV_PATH" ]; then
    echo "   Creating Python virtual environment..."
    python3 -m venv "$VENV_PATH"
fi

# Ensure dependencies are installed
echo "   Ensuring dependencies are installed..."
"$VENV_PATH/bin/python" -m pip install -q -r "otef-interactive/scripts/requirements.txt"

# Fetch source layers if needed
echo "   Fetching source layers if needed..."
"$VENV_PATH/bin/python" "otef-interactive/scripts/fetch_data.py" --output "otef-interactive/public/source"


if docker info >/dev/null 2>&1; then
    MANIFEST_PATH="otef-interactive/public/processed/layers/layers-manifest.json"
    # Only process if manifest doesn't exist or is older than source files
    SHOULD_PROCESS=true
    if [ -f "$MANIFEST_PATH" ]; then
        MANIFEST_TIME=$(stat -f "%m" "$MANIFEST_PATH" 2>/dev/null || stat -c "%Y" "$MANIFEST_PATH" 2>/dev/null || echo "0")
        SOURCE_DIR="otef-interactive/public/source/layers"
        # Check if any source files are newer than manifest
        if [ -d "$SOURCE_DIR" ]; then
            NEWER_FILES=$(find "$SOURCE_DIR" -type f -newer "$MANIFEST_PATH" 2>/dev/null | wc -l)
            if [ "$NEWER_FILES" -eq 0 ]; then
                echo "   Layer packs already processed (manifest up to date), skipping..."
                SHOULD_PROCESS=false
            fi
        fi
    fi

    if [ "$SHOULD_PROCESS" = true ]; then
        echo "   Processing layer packs (process_layers.py)..."
        "$VENV_PATH/bin/python" "otef-interactive/scripts/process_layers.py" \
            --source "otef-interactive/public/source/layers" \
            --output "otef-interactive/public/processed/layers"
    fi
else
    echo "   Warning: Docker not running, skipping layer pack processing"
fi

echo "6️⃣  Rebuilding and starting containers..."
COMPOSE_BAKE=true docker-compose up --build -d

echo ""
echo "✅ All done! Containers are running in the background."
echo ""

# Get local IP address
get_local_ip() {
    # Try different methods to get the local IP
    if [ "$(uname)" = "Darwin" ]; then
        # macOS: Get the default interface and its IP
        local default_if=$(route get default 2>/dev/null | grep interface | awk '{print $2}')
        if [ -n "$default_if" ]; then
            local ip=$(ipconfig getifaddr "$default_if" 2>/dev/null)
            if [ -n "$ip" ] && [ "$ip" != "127.0.0.1" ]; then
                echo "$ip"
                return
            fi
        fi
        # Fallback: try common interfaces
        for iface in en0 en1 en2 en3; do
            local ip=$(ipconfig getifaddr "$iface" 2>/dev/null)
            if [ -n "$ip" ] && [ "$ip" != "127.0.0.1" ]; then
                echo "$ip"
                return
            fi
        done
        # Last resort: use ifconfig to find first non-loopback IPv4
        ifconfig 2>/dev/null | grep -E "inet [0-9]" | grep -v "127.0.0.1" | awk '{print $2}' | head -1 | grep -v "^$"
    elif command -v ip >/dev/null 2>&1; then
        ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' | grep -v "^$"
    elif command -v hostname >/dev/null 2>&1; then
        hostname -I 2>/dev/null | awk '{print $1}' | grep -v "^$"
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
