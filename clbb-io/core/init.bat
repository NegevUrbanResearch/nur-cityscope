@echo off
setlocal

echo Waiting for database to be ready...
:wait_loop
python -c "import psycopg2; psycopg2.connect('dbname=postgres user=postgres password=postgres host=db port=5432')" 2>nul
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_loop
)
echo Database is ready!

echo Running migrations...
python manage.py migrate

REM Check if this is first-time initialization
set INIT_FLAG=C:\app\data\db_initialized
if not exist "%INIT_FLAG%" (
    echo First time initialization...
    
    REM Clean up existing data
    echo Cleaning up existing data...
    python manage.py shell -c "from backend.models import *; DashboardFeedState.objects.all().delete(); Indicator.objects.all().delete(); State.objects.all().delete(); IndicatorData.objects.all().delete(); IndicatorGeoJSON.objects.all().delete(); LayerConfig.objects.all().delete(); MapType.objects.all().delete()"
    
    REM Create default admin user if it doesn't exist
    echo Creating default admin user...
    python manage.py shell -c "from django.contrib.auth.models import User; User.objects.create_superuser('admin', 'admin@example.com', 'admin123') if not User.objects.filter(username='admin').exists() else None"
    
    REM Create initialization flag
    mkdir "%INIT_FLAG%\.." 2>nul
    type nul > "%INIT_FLAG%"
)

REM Check if we need to process data
if not exist "C:\app\data\processed\indicators\*" (
    if "%USE_SAMPLE_DATA%"=="true" (
        echo No processed data found. Processing data...
        python -c "from websocket_app.utils.data_manager import data_manager; import asyncio; asyncio.run(data_manager.process_all())"
    ) else (
        echo Using existing data...
    )
) else (
    echo Using existing data...
)

echo Starting server...
python manage.py runserver 0.0.0.0:9900
