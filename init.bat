@echo off
echo Waiting for database to be ready...
:wait_loop
timeout /t 1 /nobreak > nul
nc -z db 5432
if errorlevel 1 goto wait_loop
echo Database is ready!

echo Running database migrations...
python manage.py makemigrations backend
python manage.py migrate backend
python manage.py migrate

REM Check if this is the first run
set INIT_FLAG=C:\app\data\db_initialized
if not exist "C:\app\data" mkdir "C:\app\data"

if not exist "%INIT_FLAG%" (
    echo First time initialization detected...
    
    REM Clean up existing data
    echo Cleaning up existing data...
    python manage.py shell -c "from backend.models import Indicator, State, IndicatorData, IndicatorGeojson, LayerConfig, DashboardFeedState; DashboardFeedState.objects.all().delete(); LayerConfig.objects.all().delete(); IndicatorGeojson.objects.all().delete(); IndicatorData.objects.all().delete(); State.objects.all().delete(); Indicator.objects.all().delete();"

    REM Create sample data
    echo Creating sample data...
    python manage.py create_sample_data

    REM Create default admin user if it doesn't exist
    echo Creating default admin user...
    python manage.py shell -c "from django.contrib.auth.models import User; User.objects.create_superuser('admin', 'admin@example.com', 'admin123') if not User.objects.filter(username='admin').exists() else None;"

    REM Create flag file to indicate initialization is done
    type nul > "%INIT_FLAG%"
    echo First time initialization completed.
) else (
    echo Database already initialized, skipping first-time setup.
)

echo Starting the server...
python manage.py runserver 0.0.0.0:9900 