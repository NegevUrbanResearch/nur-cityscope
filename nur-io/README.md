# nur-CityScope Backend

Django REST API with WebSocket support for real-time urban planning visualization.

## Stack

- Django 4.2 + Django REST Framework
- Django Channels + Redis (WebSocket)
- PostgreSQL
- Pillow, Pandas, Matplotlib

## Structure

```
nur-io/django_api/
├── core/                 # Django project config
│   ├── settings.py
│   ├── urls.py
│   └── asgi.py           # ASGI for WebSockets
├── backend/              # Main app
│   ├── models.py         # Indicator, State, UserUpload, etc.
│   ├── views.py          # API endpoints
│   ├── serializers.py
│   ├── globals.py        # Runtime state
│   ├── climate_scenarios.py
│   └── management/commands/
│       └── create_data.py  # Data initialization
├── websocket_app/        # Real-time features
│   ├── consumers.py      # WebSocket handlers
│   └── routing.py
├── public/processed/     # Visualization assets
└── requirements.txt
```

## Models

- **Table**: Higher-level container for organizing indicators by data source (e.g., 'otef', 'idistrict')
- **Indicator**: Mobility, Climate indicator definitions (belongs to a Table)
- **State**: Scenario configurations (year, scenario type)
- **IndicatorData**: Links indicators to states
- **IndicatorImage**: Visualization images/videos per state
- **DashboardFeedState**: Chart data per state
- **LayerConfig**: Deck.gl layer configurations
- **UserUpload**: User-uploaded images with categories

### Table Parameter

**Important**: All API endpoints that query indicators by `indicator_id` require a `table` parameter to be specified. The table parameter identifies which data source/table the indicator belongs to (e.g., 'idistrict', 'otef'). All existing data and indicators are associated with the `idistrict` table.

## API Endpoints

### REST API

```
GET  /api/indicators/
GET  /api/states/
GET  /api/dashboard_feed_state/?dashboard_type=mobility
GET  /api/user_uploads/
POST /api/user_uploads/
GET  /api/user_upload_categories/
POST /api/user_upload_categories/

GET  /api/actions/get_global_variables/
POST /api/actions/set_current_indicator/
POST /api/actions/set_climate_scenario/
POST /api/actions/set_visualization_mode/
GET  /api/actions/get_image_data/
GET  /api/actions/get_deckgl_data/
GET  /api/actions/get_presentation_state/
POST /api/actions/set_presentation_state/
POST /api/actions/set_active_user_upload/
```

### WebSocket

```
/ws/presentation/  # Real-time state updates
```

Messages:
- `indicator_update`: Indicator/state changes
- `presentation_update`: Presentation playback state

## Commands

```bash
# Initialize data from public/processed/
python manage.py create_data

# Database
python manage.py makemigrations
python manage.py migrate

# Create admin user
python manage.py createsuperuser
```

## Initialization

**Important**: The initialization script `init.sh` is located at `nur-io/django_api/init.sh`. This script:
- Runs database migrations
- Creates `Table` objects (`otef` and `idistrict`)
- Sets up indicators and associates them with the `idistrict` table
- Loads data from `public/processed/` on first run
- Creates the default admin user

The script executes automatically when the Docker container starts. To modify initialization behavior, edit `nur-io/django_api/init.sh` and restart the container.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SECRET_KEY` | Django secret key |
| `DEBUG` | Debug mode (True/False) |
| `ALLOWED_HOSTS` | Allowed hostnames |
| `CORS_ALLOW_ALL_ORIGINS` | CORS configuration |

## Data Loading

The `create_data` management command:
1. Scans `public/processed/` for visualization assets
2. Creates Indicator and State records
3. Links images/videos to indicator-state combinations
4. Loads dashboard chart data from CSV files

```
public/processed/
├── climate/
│   ├── utci/*.jpg      # UTCI thermal maps
│   └── plan/*.jpg      # Planning diagrams
└── mobility/
    ├── present/
    │   ├── image/      # MP4 animations
    │   └── map/        # HTML interactive maps
    └── survey/
        ├── image/
        └── map/
```

## Docker

```bash
# Run with compose
docker-compose up -d nur-api

# Shell access
docker-compose exec nur-api bash

# Logs
docker-compose logs -f nur-api
```
