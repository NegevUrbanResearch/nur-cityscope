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

echo Creating sample data...
python manage.py shell -c "exec(open('/app/create_sample_data.py').read())"

echo Creating default admin user...
python manage.py shell -c "from django.contrib.auth.models import User; from django.db import IntegrityError; try: User.objects.create_superuser('admin', 'admin@example.com', 'admin123'); print('Admin user created successfully'); except IntegrityError: print('Admin user already exists')"

echo Starting the server...
python manage.py runserver 0.0.0.0:9900 