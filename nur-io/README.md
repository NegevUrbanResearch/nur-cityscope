# nur-CityScope Backend

This is the backend service for the nur-CityScope system, handling data processing, real-time updates, and API endpoints.

## Project Structure

```
nur-io/
└── django_api/                 # Django project root
    ├── core/                   # Django project settings
    │   ├── settings.py         # Project configuration
    │   ├── urls.py             # Main URL routing
    │   ├── asgi.py             # ASGI configuration (WebSockets)
    │   └── wsgi.py             # WSGI configuration
    ├── backend/                # Main Django application
    │   ├── management/         # Django management commands
    │   │   └── commands/
    │   │       └── create_sample_data.py  # Data creation command
    │   ├── migrations/         # Database migrations
    │   ├── models.py           # Database models
    │   ├── views.py            # API endpoints
    │   ├── serializers.py      # DRF serializers
    │   ├── urls.py             # App URL routing
    │   ├── admin.py            # Django admin
    │   ├── globals.py          # Global variables
    │   └── tests.py            # Unit tests
    ├── websocket_app/          # Real-time WebSocket functionality
    │   ├── consumers.py        # WebSocket consumers
    │   ├── routing.py          # WebSocket URL routing
    │   └── utils/              # WebSocket utilities
    │       ├── data_manager.py    # Data management
    │       └── data_updater.py    # Real-time updates
    ├── manage.py               # Django management script
    ├── requirements.txt        # Python dependencies
    ├── init.sh                 # Initialization script
    └── Dockerfile              # Docker configuration
```
**Note**: A `django_api/media/` directory is created automatically at runtime when Django generates images, maps, and other media files, but is not in the source code.


## API Endpoints

### Main Endpoints
- `/api/indicators/` - Indicator management
- `/api/dashboard_feed_state/` - Dashboard data
- `/api/actions/` - Interactive actions (state changes, data retrieval)

### WebSocket Endpoints
- `/ws/dashboard/` - Dashboard real-time updates
- `/ws/map/` - Map real-time updates

## Data Management

#### Sample Data Creation
The system includes a comprehensive sample data generator:

```bash
# Generate all sample data (indicators, states, dashboard data, images, GeoJSON)
docker exec -it nur-api python manage.py create_sample_data
```

#### Export Database
```bash
docker exec -it nur-db pg_dump -U postgres -W -h localhost db > db.sql
```

#### Import Database
```bash
# Reset database
docker exec -i nur-db psql db -U postgres -c "DROP SCHEMA public CASCADE;CREATE SCHEMA public;GRANT ALL ON SCHEMA public TO postgres;"

# Import data
docker exec -i nur-db psql db -U postgres < db.sql
```

## Development

### Project Architecture

The backend follows a clean Django architecture:

1. **Core Project** (`core/`): Django project settings and configuration
2. **Backend App** (`backend/`): Main application with models, views, and APIs
3. **WebSocket App** (`websocket_app/`): Real-time communication handling
4. **Management Commands**: Data generation and management utilities

### Adding New Features

1. **Models**: Add to `backend/models.py`
2. **API Endpoints**: Add to `backend/views.py` and `backend/urls.py`
3. **Real-time Features**: Update `websocket_app/consumers.py`
4. **Data Processing**: Add management commands in `backend/management/commands/`

### Testing
```bash
# Run all tests
docker exec -it nur-api python manage.py test

# Run specific app tests
docker exec -it nur-api python manage.py test backend
docker exec -it nur-api python manage.py test websocket_app

# Check Django configuration
docker exec -it nur-api python manage.py check
```

### Database Migrations
```bash
# Create migrations for model changes
docker exec -it nur-api python manage.py makemigrations

# Apply migrations
docker exec -it nur-api python manage.py migrate

# View migration status
docker exec -it nur-api python manage.py showmigrations
```

## Configuration

### Environment Variables
Key environment variables (set in `.env`):

- `API_PORT`: Backend API port (default: 9900)
- `FRONT_PORT`: Frontend port (default: 8500)
- `POSTGRES_DB`: Database name
- `POSTGRES_USER`: Database user
- `POSTGRES_PASSWORD`: Database password
- `DATABASE_URL`: Full database connection string

### Django Settings
Main settings are in `core/settings.py`:

- Database configuration using `dj_database_url`
- CORS settings for frontend communication
- Django Channels configuration for WebSockets
- Media file handling


## API Documentation

### Interactive API Documentation
- Swagger UI: `http://localhost:8500/api/swagger/`
- ReDoc: `http://localhost:8500/api/redoc/`