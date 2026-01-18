# === nur-CityScope Setup Script (Windows PowerShell) ===
# This script sets up the nur-CityScope project using Docker.

# Determine script directory
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path

# Navigate to script directory
Set-Location $SCRIPT_DIR

# Create necessary migration folders
Write-Host "Creating required migration folders..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "$SCRIPT_DIR\nur-io\core\external_files" | Out-Null
New-Item -ItemType Directory -Force -Path "$SCRIPT_DIR\nur-io\core\migrations" | Out-Null
New-Item -ItemType Directory -Force -Path "$SCRIPT_DIR\nur-io\backend\migrations" | Out-Null

# Create empty __init__.py files
if (-not (Test-Path "$SCRIPT_DIR\nur-io\core\migrations\__init__.py")) {
    New-Item -ItemType File -Path "$SCRIPT_DIR\nur-io\core\migrations\__init__.py" | Out-Null
}
if (-not (Test-Path "$SCRIPT_DIR\nur-io\backend\migrations\__init__.py")) {
    New-Item -ItemType File -Path "$SCRIPT_DIR\nur-io\backend\migrations\__init__.py" | Out-Null
}

# Copy logo to required locations
Write-Host "Ensuring logo files are in place..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "$SCRIPT_DIR\nur-io\django_api\media" | Out-Null
New-Item -ItemType Directory -Force -Path "$SCRIPT_DIR\nur-front\frontend\public\media" | Out-Null
$logoSource = "$SCRIPT_DIR\nur-front\frontend\public\Nur-Logo_3x-_1_.svg"
if (Test-Path $logoSource) {
    Copy-Item -Path $logoSource -Destination "$SCRIPT_DIR\nur-io\django_api\media\" -Force
    Copy-Item -Path $logoSource -Destination "$SCRIPT_DIR\nur-front\frontend\public\media\" -Force
}

# Handle Docker network - remove if it exists with wrong labels, then let compose create it
Write-Host "Setting up Docker network..." -ForegroundColor Cyan
$networkExists = docker network inspect nur_core 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Removing existing network to avoid conflicts..." -ForegroundColor Yellow
    docker network rm nur_core 2>$null
    Start-Sleep -Seconds 2
}

# Start the services (build if needed)
Write-Host "Starting services (this may take a while on first run)..." -ForegroundColor Cyan
$env:COMPOSE_BAKE = "true"
docker-compose up -d --build

# Wait for containers to be running
Write-Host "Waiting for containers to be ready..." -ForegroundColor Cyan
$maxAttempts = 30
$attempt = 0
$containersReady = $false

while ($attempt -lt $maxAttempts -and -not $containersReady) {
    Start-Sleep -Seconds 2
    $apiStatus = docker ps --filter "name=nur-api" --format "{{.Status}}" 2>$null
    if ($apiStatus -and $apiStatus -match "Up") {
        $containersReady = $true
        Write-Host "Containers are ready!" -ForegroundColor Green
    } else {
        $attempt++
        Write-Host "Waiting for containers... ($attempt/$maxAttempts)" -ForegroundColor Gray
    }
}

if (-not $containersReady) {
    Write-Host "Warning: Containers may not be fully ready. Checking status..." -ForegroundColor Yellow
    docker-compose ps
    Write-Host "You may need to wait a bit longer or check logs with: docker-compose logs" -ForegroundColor Yellow
}

# Copy logo file into nginx container (wait a bit more for nginx)
Start-Sleep -Seconds 5
Write-Host "Ensuring logo is accessible in nginx container..." -ForegroundColor Cyan
if (Test-Path $logoSource) {
    $nginxRunning = docker ps --filter "name=nginx-front" --format "{{.Status}}" 2>$null
    if ($nginxRunning -and $nginxRunning -match "Up") {
        docker cp "$logoSource" nginx-front:/usr/share/nginx/html/media/ 2>$null
    } else {
        Write-Host "Warning: nginx container not ready yet, logo copy skipped" -ForegroundColor Yellow
    }
}

# Setup OTEF Interactive module - PMTiles generation
$pmtilesFile = "$SCRIPT_DIR\otef-interactive\frontend\data\parcels.pmtiles"
if (-not (Test-Path $pmtilesFile)) {
    Write-Host "Setting up OTEF PMTiles generation environment..." -ForegroundColor Cyan

    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCmd) {
        $pythonCmd = Get-Command python3 -ErrorAction SilentlyContinue
    }

    if ($pythonCmd) {
        # Create venv and install dependencies
        $venvPath = "$SCRIPT_DIR\otef-interactive\scripts\.venv"
        if (-not (Test-Path $venvPath)) {
            Write-Host "Creating Python virtual environment for tile generation..." -ForegroundColor Gray
            & $pythonCmd.Name -m venv "$venvPath"
        }

        # Install dependencies
        Write-Host "Installing tile generation dependencies..." -ForegroundColor Gray
        & "$venvPath\Scripts\pip" install pyproj pmtiles -q

        # Check if Docker is running for tile generation
        $dockerRunning = docker info 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Generating PMTiles for parcels layer..." -ForegroundColor Cyan
            & "$venvPath\Scripts\python" "$SCRIPT_DIR\otef-interactive\scripts\generate-pmtiles.py"
            if ($LASTEXITCODE -ne 0) {
                Write-Host "Warning: PMTiles generation failed. Parcels will load slower via GeoJSON." -ForegroundColor Yellow
            }
        } else {
            Write-Host "Warning: Docker not running, skipping PMTiles generation" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Warning: Python not found, skipping PMTiles generation" -ForegroundColor Yellow
    }
}

# Run migrations (only if container is running)
Write-Host "Running database migrations..." -ForegroundColor Cyan
$apiRunning = docker ps --filter "name=nur-api" --format "{{.Status}}" 2>$null
if ($apiRunning -and $apiRunning -match "Up") {
    docker exec nur-api python manage.py migrate
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: Migrations may have failed. Check logs with: docker-compose logs nur-api" -ForegroundColor Yellow
    }
} else {
    Write-Host "Error: nur-api container is not running. Check logs with: docker-compose logs nur-api" -ForegroundColor Red
    Write-Host "You may need to rebuild containers: docker-compose up --build -d" -ForegroundColor Yellow
    exit 1
}

# Create data (loads real data from public/)
Write-Host "Creating data structure..." -ForegroundColor Cyan
docker exec nur-api python manage.py create_data
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: Data creation may have failed. Check logs with: docker-compose logs nur-api" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "All services have been successfully configured and data has been loaded." -ForegroundColor Green
Write-Host "You can now access:" -ForegroundColor Green
Write-Host "- Dashboard: http://localhost/dashboard/" -ForegroundColor Cyan
Write-Host "- Projection: http://localhost/projection/" -ForegroundColor Cyan
Write-Host "- Remote Controller: http://localhost/remote/" -ForegroundColor Cyan
Write-Host "- OTEF Interactive: http://localhost/otef-interactive/" -ForegroundColor Cyan
Write-Host "- OTEF Projection: http://localhost/otef-interactive/projection.html" -ForegroundColor Cyan
Write-Host "- Admin Interface: http://localhost:9900/admin" -ForegroundColor Cyan
