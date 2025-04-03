# CLBB-CityScope Backend

This is the backend service for the CLBB-CityScope system, handling data processing, real-time updates, and API endpoints.

## Project Structure

```
clbb-io/
├── calculations/              # Data processing modules
│   ├── modules/              # Processing implementations
│   │   └── base.py          # Base processor class
│   └── README.md            # Processing documentation
├── core/                     # Main Django application
│   ├── backend/             # Django models and views
│   │   ├── models.py        # Database models
│   │   ├── views.py         # API endpoints
│   │   └── urls.py          # URL routing
│   ├── core/                # Django project settings
│   │   ├── settings.py      # Project configuration
│   │   ├── urls.py          # Main URL routing
│   │   └── wsgi.py          # WSGI configuration
│   ├── data/                # Data storage
│   │   ├── raw/            # Raw input data
│   │   └── processed/      # Processed output data
│   ├── external_files/      # External data sources
│   ├── management/          # Django management commands
│   ├── media/              # User-uploaded files
│   ├── migrations/         # Database migrations
│   ├── websocket_app/      # Real-time updates
│   │   └── utils/          # WebSocket utilities
│   │       ├── data_manager.py    # Data management
│   │       └── data_updater.py    # Real-time updates
│   ├── init.sh             # Unix initialization script
│   ├── init.bat            # Windows initialization script
│   └── manage.py           # Django management
└── docker-compose.yml      # Docker configuration
```

## Setup Instructions

### Docker Setup (Recommended)

1. Build and start containers:
```bash
docker-compose up -d --build
```

2. Apply database migrations:
```bash
docker exec -it clbb_web python manage.py migrate
```

3. Create superuser (follow prompts):
```bash
docker exec -it clbb_web python manage.py createsuperuser
```

4. Access admin panel:
```
http://localhost:8500/admin
```

### Manual Setup (Development)

1. Create virtual environment:
```bash
# Unix
python3 -m venv venv
source venv/bin/activate

# Windows
python -m venv venv
venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Initialize database:
```bash
# Unix
./init.sh

# Windows
init.bat
```

## Data Management

### Data Directory Structure
- `/data/raw/`: Place raw data files here
- `/data/processed/`: Contains processed data
- `/external_files/`: External data sources
- `/media/`: User-uploaded files

### Data Processing
1. Place raw data in appropriate directories
2. Run data processing:
```bash
docker exec -it clbb_web python manage.py process_data
```

### Database Management

#### Export Database
```bash
docker exec -it clbb_db pg_dump -U postgres -W -h clbb_db clbb > clbb_db.sql
```

#### Import Database
```bash
# Reset database
docker exec -i clbb_db psql clbb -U postgres -c "DROP SCHEMA public CASCADE;CREATE SCHEMA public;GRANT ALL ON SCHEMA public TO postgres;"

# Import data
docker exec -i clbb_db psql clbb -U postgres < clbb_db.sql
```

## Development

### Adding New Features
1. Create new module in `calculations/modules/`
2. Update data processing pipeline
3. Add API endpoints in `backend/views.py`
4. Update WebSocket handlers if needed

### Testing
```bash
# Run tests
docker exec -it clbb_web python manage.py test

# Run specific test
docker exec -it clbb_web python manage.py test backend.tests
```

### Database Migrations
```bash
# Create migrations
docker exec -it clbb_web python manage.py makemigrations

# Apply migrations
docker exec -it clbb_web python manage.py migrate
```

## Troubleshooting

### Windows Firewall
If services are not accessible, add firewall rules:
```powershell
New-NetFirewallRule -DisplayName "CLBB-Service" -Direction Inbound -LocalPort 8500 -Protocol TCP -Action Allow
```

### Database Issues
1. Check database logs:
```bash
docker logs clbb_db
```

2. Reset database:
```bash
docker-compose down -v
docker-compose up -d
```

### WebSocket Issues
1. Check WebSocket logs:
```bash
docker logs clbb_web
```

2. Verify WebSocket connection:
```javascript
// In browser console
ws = new WebSocket('ws://localhost:8500/ws/');
ws.onmessage = (e) => console.log(e.data);
```

## Image Capture System

### Database Synchronization
*For the image capture system to communicate with the services running on the PC, they must share the same database. Instructions for database duplication are provided below.*

### Setup Instructions

1. Create virtual environment:
```bash
# Install virtualenv if not already installed
python3 install virtualenv

# Navigate to camera directory
cd $PATH_TO_PROJECT/camera/

# Create virtual environment
python3 -m venv clbb
```

2. Activate virtual environment:
```bash
# Windows
clbb\Scripts\activate

# Unix
source clbb/bin/activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Start image capture:
```bash
python3 capture.py
```

### Database Synchronization

#### Export Database (Server)
```bash
docker exec -it clbb_db pg_dump -U postgres -W -h clbb_db clbb > clbb_db.sql
```

#### Import Database (Client)
```bash
# Reset database
docker exec -i clbb_db psql clbb -U postgres -c "DROP SCHEMA public CASCADE;CREATE SCHEMA public;GRANT ALL ON SCHEMA public TO postgres;"

# Import data
docker exec -i clbb_db psql clbb -U postgres < clbb_db.sql
```




