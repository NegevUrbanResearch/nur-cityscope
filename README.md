# nur-CityScope

Urban planning dashboard for visualizing mobility and climate scenarios, designed for projection-mapped physical models.

## Overview

Multi-service application for interactive urban data visualization:

- **nur-io**: Django REST API + WebSocket backend
- **nur-front**: React dashboard with deck.gl maps
- **nur-projection**: Projection mapping display (Maptastic.js)
- **nur-remote-controller**: Mobile-friendly presentation remote
- **nginx**: Reverse proxy

OTEF Interactive is a separate repository, [Otef_interactive](https://github.com/NegevUrbanResearch/Otef_interactive). This repository serves the iDistrict dashboard, projection, and remote.
- **PostgreSQL + Redis**: Database and WebSocket support

## Architecture

```
???????????????????????????????????????????????????????????????
?                        nginx :80                             ?
???????????????????????????????????????????????????????????????
?  /dashboard/     ? React SPA                                ?
?  /projection/    ? Projection display                       ?
?  /remote-controller/ ? Presentation remote                  ?
?  /api/           ? Django API :9900                         ?
?  /ws/            ? WebSocket (Channels)                     ?
?  /media/         ? Static media files                       ?
???????????????????????????????????????????????????????????????
         ?                    ?
         ?                    ?
    PostgreSQL             Redis
```

## Quick Start

The application is fully containerized via `docker-compose.yml` - no local dependencies required beyond Docker.

### Prerequisites

- Docker and Docker Compose
```

# Start everything
docker-compose up -d --build

# Check status
docker-compose ps
docker-compose logs -f nur-api
```

### Environment Variables

Create a `.env` file in the project root:

```env
# Database
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=nur_db
DATABASE_URL=postgres://postgres:your_secure_password@db:5432/nur_db

# Ports
API_PORT=9900
FRONT_PORT=80

# Django
DEBUG=True
SECRET_KEY=your-secret-key-here
ALLOWED_HOSTS=*
CSRF_TRUSTED_ORIGINS=http://localhost:9900,http://127.0.0.1:9900
CORS_ALLOW_ALL_ORIGINS=True

# Mapbox (required for maps)
REACT_APP_MAPBOX_ACCESS_TOKEN=your-mapbox-token
```

Copy from `.env.example` and fill in your values.

## Access Points

| Service | URL |
|---------|-----|
| Site root | http://localhost/ redirects to the dashboard |
| Dashboard | http://localhost/dashboard/ |
| Projection Display | http://localhost/projection/ |
| Remote Controller | http://localhost/remote-controller/ |
| API | http://localhost:9900/api/ |
| Admin | http://localhost:9900/admin (admin/admin123) |

## Data Organization

Visualization data lives in `nur-io/django_api/public/processed/`:

```
processed/
??? climate/
?   ??? utci/        # Thermal comfort maps
?   ??? plan/        # Planning diagrams
??? mobility/
?   ??? present/     # Current state visualizations
?   ??? survey/      # Survey data
?   ??? future/      # Future scenarios
```

The system automatically loads this data into the database on first startup.

## Climate Scenarios

Seven scenarios available, each with UTCI (thermal comfort) and Plan (urban model) views:
- Existing (baseline)
- Dense-Highrise
- High-Rises
- Lowrise
- Mass Tree Planting
- Open Public Space
- Placemaking

## Keyboard Shortcuts

**Table Switching** (Shift+Z to open popup):
- **Shift+Z** - Open/close table switcher
- **T** - Switch to next table (when popup open)
- **Esc** - Close popup

Note: Remote controller pages have UI buttons for table switching instead.

## Common Tasks

### Reload Data
```bash
docker-compose exec nur-api python manage.py create_data
```

### Database Operations
```bash
# Migrations
docker-compose exec nur-api python manage.py makemigrations
docker-compose exec nur-api python manage.py migrate

# Backup
docker exec nur-db pg_dump -U postgres nur_db > backup.sql

# Restore
docker exec -i nur-db psql -U postgres nur_db < backup.sql
```

### Reset Everything
```bash
./reset-docker.sh
```

## Project Structure

```
nur-cityscope/
??? docker-compose.yml
??? nginx/                    # Reverse proxy config
??? nur-io/django_api/        # Django backend
??? nur-front/frontend/       # React dashboard
??? nur-projection/frontend/  # Projection display
??? nur-remote-controller/   # Presentation remote
```

## How It Works

1. **Initialization**: `nur-io/django_api/init.sh` runs on container start:
   - Creates the `idistrict` table
   - Loads data from `nur-io/django_api/public/processed/` into database
   - Creates default admin user (admin/admin123)

2. **Frontend**: React app built by `dashboard-builder`, served via nginx at `/dashboard/`

3. **Backend**: Django API at `:9900` handles data, state, and WebSocket connections

4. **Projection**: Display pages synced via WebSocket for real-time updates

See individual module READMEs for details.
