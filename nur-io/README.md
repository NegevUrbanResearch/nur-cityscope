# nur-CityScope Backend

Django REST API with WebSocket support for real-time urban planning visualization.

## Tech Stack

- Django 4.2 + Django REST Framework
- Django Channels + Redis (WebSocket)
- PostgreSQL
- Pillow, Pandas, Matplotlib

## Project Structure

```
django_api/
├── core/              # Django project settings
├── backend/           # Main app
│   ├── models.py      # Database models
│   ├── views.py       # API endpoints
│   ├── serializers.py
│   └── management/commands/
│       └── create_data.py  # Data loading
├── websocket_app/     # WebSocket handlers
├── public/processed/  # Visualization assets
└── init.sh            # Startup script
```

## Models

- **Table**: Organizes indicators by data source (`otef`, `idistrict`)
- **Indicator**: Metrics like mobility/climate data (belongs to a Table)
- **State**: Different scenarios or time periods
- **IndicatorData**: Links indicators with states
- **IndicatorImage**: Visualization images/videos
- **DashboardFeedState**: Chart data
- **LayerConfig**: Deck.gl layer configs
- **UserUpload**: User-uploaded content
- **GISLayer**: GIS data for OTEF module
- **OTEFModelConfig**: OTEF model configuration

## API Endpoints

### Core Resources
```
GET  /api/tables/
GET  /api/indicators/?table=<table_name>
GET  /api/states/
GET  /api/dashboard_feed_state/?dashboard_type=mobility
GET  /api/user_uploads/
POST /api/user_uploads/
```

### Actions
```
GET  /api/actions/get_global_variables/
POST /api/actions/set_current_indicator/
POST /api/actions/set_climate_scenario/
POST /api/actions/set_visualization_mode/
GET  /api/actions/get_image_data/
GET  /api/actions/get_deckgl_data/
GET  /api/actions/get_presentation_state/
POST /api/actions/set_presentation_state/
GET  /api/actions/get_otef_layers/?table=otef
```

### OTEF Endpoints
```
GET  /api/otef_model_config/
GET  /api/otef_viewport/
POST /api/otef_viewport/
```

### WebSocket
```
/ws/presentation/  # Real-time state sync
/ws/otef/         # OTEF viewport sync
```

## Initialization

The `init.sh` script runs automatically when the container starts:

1. Runs database migrations
2. Creates `otef` and `idistrict` tables
3. Sets up indicators for `idistrict` table
4. Loads data from `public/processed/` on first run
5. Creates default admin user (admin/admin123)

To modify initialization, edit `init.sh` and restart the container.

## Data Loading

**Climate/Mobility data**: The `create_data` command scans `public/processed/` and:
- Creates Indicator and State records
- Links images/videos to indicator-state combinations
- Loads dashboard chart data from CSV files

**OTEF data**: Imported separately via `import_otef_data` command from `public/processed/otef/`

Run manually:
```bash
docker-compose exec nur-api python manage.py create_data      # Climate/mobility
docker-compose exec nur-api python manage.py import_otef_data # OTEF layers
```

## Development

```bash
# Shell access
docker-compose exec nur-api bash

# Migrations
python manage.py makemigrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser

# Watch logs
docker-compose logs -f nur-api
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SECRET_KEY` | Django secret key |
| `DEBUG` | Debug mode (True/False) |
| `ALLOWED_HOSTS` | Allowed hostnames |
| `CORS_ALLOW_ALL_ORIGINS` | CORS configuration |

## Important Notes

- All indicator queries require a `table` parameter (e.g., `?table=idistrict`)
- Most existing data is associated with the `idistrict` table
- OTEF data lives in `public/processed/otef/` and is imported via `import_otef_data` command
