# Reset Docker containers and volumes (Windows PowerShell)

Write-Host "Resetting Docker containers and volumes..." -ForegroundColor Yellow
Write-Host ""

# Stop all containers
Write-Host "1. Stopping all containers..." -ForegroundColor Cyan
docker-compose down

# Remove volumes to clear database and media
Write-Host "2. Removing volumes (this will delete the database and media files)..." -ForegroundColor Cyan
$volumes = @(
    "nur-cityscope_postgres_data_core",
    "nur-cityscope_media_files",
    "nur-cityscope_nur-api_data"
)

foreach ($volume in $volumes) {
    docker volume rm $volume 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   (Volume $volume may not exist, that's okay)" -ForegroundColor Gray
    }
}

# Remove the initialization flag from the data directory (if it exists locally)
Write-Host "3. Removing initialization flags..." -ForegroundColor Cyan
$initFlag = "nur-io\django_api\data\db_initialized"
$checksumFile = "nur-io\django_api\data\assets_checksum"
if (Test-Path $initFlag) {
    Remove-Item -Path $initFlag -Force
}
if (Test-Path $checksumFile) {
    Remove-Item -Path $checksumFile -Force
}
Write-Host "   (Flags removed if they existed)" -ForegroundColor Gray

# Prune unused Docker images only (keeps all containers, including unrelated ones like n8n)
Write-Host "4. Pruning unused Docker images (containers will be kept)..." -ForegroundColor Cyan
docker image prune -f

Write-Host ""
Write-Host "Reset complete!" -ForegroundColor Green
Write-Host ""

# Process layer packs (before starting containers)
Write-Host "5. Setting up OTEF layer packs..." -ForegroundColor Cyan

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    $pythonCmd = Get-Command python3 -ErrorAction SilentlyContinue
}

    if ($pythonCmd) {
    $venvPath = "otef-interactive\scripts\.venv"
    if (-not (Test-Path $venvPath)) {
        Write-Host "   Creating Python virtual environment..." -ForegroundColor Gray
        & $pythonCmd.Name -m venv "$venvPath"
    }

    # Ensure dependencies are installed (including new requests and tqdm)
    Write-Host "   Ensuring dependencies are installed..." -ForegroundColor Gray
    & "$venvPath\Scripts\python" -m pip install -q -r "otef-interactive\scripts\requirements.txt"

    # Fetch source layers if needed
    Write-Host "   Fetching source layers if needed..." -ForegroundColor Gray
    & "$venvPath\Scripts\python" "otef-interactive\scripts\fetch_data.py" --output "otef-interactive\public\source"

    $dockerRunning = docker info 2>$null
    if ($LASTEXITCODE -eq 0) {
        $manifestPath = "otef-interactive\public\processed\layers\layers-manifest.json"
        $shouldProcess = $true
        if (Test-Path $manifestPath) {
            $manifestTime = (Get-Item $manifestPath).LastWriteTime
            $sourceDir = "otef-interactive\public\source\layers"
            $newerFiles = Get-ChildItem -Path $sourceDir -Recurse -File -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTime -gt $manifestTime }
            if ($null -eq $newerFiles -or $newerFiles.Count -eq 0) {
                Write-Host "   Layer packs already processed (manifest up to date), skipping..." -ForegroundColor Gray
                $shouldProcess = $false
            }
        }
        if ($shouldProcess) {
            Write-Host "   Processing layer packs (process_layers.py)..." -ForegroundColor Gray
            & "$venvPath\Scripts\python" "otef-interactive\scripts\process_layers.py" `
                --source "otef-interactive\public\source\layers" `
                --output "otef-interactive\public\processed\layers"
        }
    } else {
        Write-Host "   Warning: Docker not running, skipping layer pack processing" -ForegroundColor Yellow
    }
} else {
    Write-Host "   Warning: Python not found, skipping layer pack processing" -ForegroundColor Yellow
}

# Rebuild and start containers
Write-Host "6. Rebuilding and starting containers..." -ForegroundColor Cyan
$env:COMPOSE_BAKE = "true"
docker-compose up --build -d

# Wait for API and seed database (migrate, create_data, import_otef_data)
Write-Host "7. Waiting for API and seeding database..." -ForegroundColor Cyan
Start-Sleep -Seconds 15
Write-Host "   Running migrations..." -ForegroundColor Gray
docker exec nur-api python manage.py migrate
Write-Host "   Creating data structure (states, indicator data, images)..." -ForegroundColor Gray
docker exec nur-api python manage.py create_data
Write-Host "   Importing OTEF data (layer groups, model bounds)..." -ForegroundColor Gray
docker exec nur-api python manage.py import_otef_data
if ($LASTEXITCODE -ne 0) {
    Write-Host "   (OTEF import skipped if files not present)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "All done! Containers are running in the background." -ForegroundColor Green
Write-Host ""

# Get local IP address
$localIP = $null
try {
    $networkAdapters = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.InterfaceAlias -notlike "*Loopback*"
        } |
        Sort-Object InterfaceIndex |
        Select-Object -First 1

    if ($networkAdapters) {
        $localIP = $networkAdapters.IPAddress
    }
} catch {
    # Fallback method
    $localIP = (Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object { $_.IPv4Address.IPAddress -notlike "127.*" -and $_.IPv4Address.IPAddress -notlike "169.254.*" } |
        Select-Object -First 1).IPv4Address.IPAddress
}

Write-Host "Local access (localhost):" -ForegroundColor Yellow
Write-Host "- Dashboard: http://localhost/dashboard/" -ForegroundColor Cyan
Write-Host "- Projection: http://localhost/projection/" -ForegroundColor Cyan
Write-Host "- Remote Controller: http://localhost/remote/" -ForegroundColor Cyan
Write-Host "- OTEF Interactive: http://localhost/otef-interactive/" -ForegroundColor Cyan
Write-Host "- OTEF Projection: http://localhost/otef-interactive/projection.html" -ForegroundColor Cyan
Write-Host "- Admin Interface: http://localhost:9900/admin" -ForegroundColor Cyan

if ($localIP) {
    Write-Host ""
    Write-Host "Network access (from other devices):" -ForegroundColor Yellow
    Write-Host "- Dashboard: http://$localIP/dashboard/" -ForegroundColor Cyan
    Write-Host "- Projection: http://$localIP/projection/" -ForegroundColor Cyan
    Write-Host "- Remote Controller: http://$localIP/remote/" -ForegroundColor Cyan
    Write-Host "- OTEF Interactive: http://$localIP/otef-interactive/" -ForegroundColor Cyan
    Write-Host "- OTEF Projection: http://$localIP/otef-interactive/projection.html" -ForegroundColor Cyan
    Write-Host "- Admin Interface: http://$localIP:9900/admin" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "Could not detect local IP address for network access" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "View logs with: docker-compose logs -f" -ForegroundColor Cyan
Write-Host "Stop containers with: docker-compose down" -ForegroundColor Cyan
Write-Host ""
