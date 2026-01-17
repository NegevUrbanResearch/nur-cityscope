@echo off
REM Generate PMTiles for Windows using Docker
REM Requires Docker Desktop to be installed and running

setlocal enabledelayedexpansion

echo Generating PMTiles using Docker...
echo.

REM Get script directory and project root
set SCRIPT_DIR=%~dp0
set PROJECT_ROOT=%SCRIPT_DIR%..
set DATA_SOURCE=%PROJECT_ROOT%\public\source\layers
set OUTPUT_DIR=%PROJECT_ROOT%\frontend\data

echo Source: %DATA_SOURCE%
echo Output: %OUTPUT_DIR%
echo.

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker is not running
    echo.
    echo Please start Docker Desktop and try again.
    echo.
    echo Alternative: Install tippecanoe via WSL2:
    echo   wsl sudo apt-get install tippecanoe
    echo   wsl bash %SCRIPT_DIR%generate-tiles.sh
    pause
    exit /b 1
)

REM Create output directory
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

REM Generate PMTiles for parcels
echo Processing parcels (migrashim.json)...
docker run --rm -v "%PROJECT_ROOT%:/data" yonesmiller/tippecanoe:latest ^
  tippecanoe -o /data/frontend/data/parcels.pmtiles ^
  --maximum-zoom=18 ^
  --minimum-zoom=12 ^
  --drop-densest-as-needed ^
  --extend-zooms-if-still-dropping ^
  --simplification=10 ^
  --detect-shared-borders ^
  --coalesce-densest-as-needed ^
  --layer=parcels ^
  --name="OTEF Parcels" ^
  --force ^
  /data/public/source/layers/migrashim.json

if errorlevel 1 (
    echo ERROR: Failed to generate parcels tiles
    pause
    exit /b 1
)

echo Parcels tiles generated successfully!
dir "%OUTPUT_DIR%\parcels.pmtiles"
echo.

REM Generate PMTiles for roads
echo Processing roads (small_roads.json)...
docker run --rm -v "%PROJECT_ROOT%:/data" yonesmiller/tippecanoe:latest ^
  tippecanoe -o /data/frontend/data/roads.pmtiles ^
  --maximum-zoom=18 ^
  --minimum-zoom=13 ^
  --simplification=5 ^
  --layer=roads ^
  --name="OTEF Roads" ^
  --force ^
  /data/public/source/layers/small_roads.json

if errorlevel 1 (
    echo ERROR: Failed to generate roads tiles
    pause
    exit /b 1
)

echo Roads tiles generated successfully!
dir "%OUTPUT_DIR%\roads.pmtiles"
echo.

echo All tiles generated successfully!
echo.
echo Output files:
dir "%OUTPUT_DIR%\*.pmtiles"

pause


