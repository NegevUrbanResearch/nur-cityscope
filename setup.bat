@echo off

REM === CLBB-CityScope Setup Script ===
REM This script sets up the CLBB-CityScope project using Docker.

REM Create necessary migration folders
echo Creating required migration folders...
if not exist "clbb-io\core\external_files" mkdir "clbb-io\core\external_files"
if not exist "clbb-io\core\migrations" mkdir "clbb-io\core\migrations"
if not exist "clbb-io\backend\migrations" mkdir "clbb-io\backend\migrations"

REM Create empty __init__.py files
if not exist "clbb-io\core\migrations\__init__.py" type nul > "clbb-io\core\migrations\__init__.py"
if not exist "clbb-io\backend\migrations\__init__.py" type nul > "clbb-io\backend\migrations\__init__.py"

REM Start the services
echo Starting services...
docker-compose up -d

REM Wait for services to be ready
echo Waiting for services to be ready...
timeout /t 10 /nobreak

REM Run migrations
echo Running database migrations...
docker exec core_api python manage.py migrate

REM Create sample data
echo Creating sample data...
docker exec core_api python manage.py create_sample_data

echo ✅ All services have been successfully configured and sample data has been created.
echo You can now access:
echo - Dashboard: http://localhost/dashboard/
echo - Projection: http://localhost/projection/
echo - Remote Controller: http://localhost/remote/
echo - Admin Interface: http://localhost:9900/admin


# This is the setup file
