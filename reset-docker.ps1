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
docker-compose up --build -d

Write-Host ""
Write-Host "All done! Containers are running in the background." -ForegroundColor Green
Write-Host ""
Write-Host "View logs with: docker-compose logs -f" -ForegroundColor Cyan
Write-Host "Stop containers with: docker-compose down" -ForegroundColor Cyan
Write-Host ""
