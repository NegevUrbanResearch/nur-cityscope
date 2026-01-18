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

# Prune Docker system (optional but recommended)
Write-Host "4. Pruning Docker system..." -ForegroundColor Cyan
docker system prune -f

Write-Host ""
Write-Host "Reset complete!" -ForegroundColor Green
Write-Host ""

# Rebuild and start containers
Write-Host "5. Rebuilding and starting containers..." -ForegroundColor Cyan
$env:COMPOSE_BAKE = "true"
docker-compose up --build -d

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

Write-Host "📍 Local access (localhost):" -ForegroundColor Yellow
Write-Host "- Dashboard: http://localhost/dashboard/" -ForegroundColor Cyan
Write-Host "- Projection: http://localhost/projection/" -ForegroundColor Cyan
Write-Host "- Remote Controller: http://localhost/remote/" -ForegroundColor Cyan
Write-Host "- OTEF Interactive: http://localhost/otef-interactive/" -ForegroundColor Cyan
Write-Host "- OTEF Projection: http://localhost/otef-interactive/projection.html" -ForegroundColor Cyan
Write-Host "- Admin Interface: http://localhost:9900/admin" -ForegroundColor Cyan

if ($localIP) {
    Write-Host ""
    Write-Host "🌐 Network access (from other devices):" -ForegroundColor Yellow
    Write-Host "- Dashboard: http://$localIP/dashboard/" -ForegroundColor Cyan
    Write-Host "- Projection: http://$localIP/projection/" -ForegroundColor Cyan
    Write-Host "- Remote Controller: http://$localIP/remote/" -ForegroundColor Cyan
    Write-Host "- OTEF Interactive: http://$localIP/otef-interactive/" -ForegroundColor Cyan
    Write-Host "- OTEF Projection: http://$localIP/otef-interactive/projection.html" -ForegroundColor Cyan
    Write-Host "- Admin Interface: http://$localIP:9900/admin" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "⚠️  Could not detect local IP address for network access" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "View logs with: docker-compose logs -f" -ForegroundColor Cyan
Write-Host "Stop containers with: docker-compose down" -ForegroundColor Cyan
Write-Host ""
