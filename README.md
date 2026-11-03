# nur-CityScope

Urban planning dashboard for visualizing mobility and climate scenarios, designed for projection-mapped physical models.

## Overview

Multi-service application for interactive urban data visualization:

- **nur-io**: Django REST API + WebSocket backend
- **nur-front**: React dashboard with deck.gl maps
- **nur-projection**: Projection mapping display (Maptastic.js)
- **nur-remote-controller**: Mobile-friendly presentation remote
- **nginx**: Reverse proxy
- **PostgreSQL + Redis**: Database and WebSocket support

OTEF Interactive is a separate repository, [Otef_interactive](https://github.com/NegevUrbanResearch/Otef_interactive). This repository serves the iDistrict dashboard, projection, and remote.

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                        nginx :80                              │
├───────────────────────────────────────────────────────────────┤
│  /                  │ Redirects to /dashboard/                │
│  /dashboard/        │ React SPA                               │
│  /projection/       │ Projection display                      │
│  /remote-controller/│ Presentation remote                     │
│  /api/              │ Django API :9900                        │
│  /ws/               │ WebSocket (Channels)                    │
│  /media/            │ Static media files                      │
└───────────────────────────────────────────────────────────────┘
         │                    │
         │                    │
    PostgreSQL             Redis
```

## Quick Start

The application is fully containerized via `docker-compose.yml`. No local dependencies required beyond Docker.

### Prerequisites

- Docker and Docker Compose

```bash
# Start everything
docker-compose up -d --build

# Check status
docker-compose ps
docker-compose logs -f nur-api
```

`setup.ps1` and `setup.sh` start the same stack, then run migrations and `create_data`.

If port 80 is already in use, set `FRONT_PORT` in `.env` before starting and open that port instead of 80.

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

# Mapbox (required for maps)
REACT_APP_MAPBOX_ACCESS_TOKEN=your-mapbox-token
```

Copy from `.env.example` and fill in your values.

## Access Points

| Service | URL |
|---------|-----|
| Site root | http://localhost/ (redirects to the dashboard) |
| Dashboard | http://localhost/dashboard/ |
| Projection Display | http://localhost/projection/ |
| Remote Controller | http://localhost/remote-controller/ |
| API | http://localhost:9900/api/ |
| Admin | http://localhost:9900/admin (admin/admin123) |

`/remote` redirects to `/remote-controller/`.

## Data Organization

Visualization data lives in `nur-io/django_api/public/processed/`:

```
processed/
├── climate/
│   ├── utci/        # Thermal comfort maps
│   └── plan/        # Planning diagrams
└── mobility/
    ├── present/     # Current state visualizations
    ├── survey/      # Survey data
    └── future/      # Future scenarios
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

On the projection page, Shift+Z toggles calibration. Drag the corners to fit the image to the model. Press X to reset.

Remote controller pages have UI buttons for table switching instead.

## Common Tasks

### Reload Data

```bash
docker-compose exec nur-api python manage.py create_data
```

### Database Operations

```bash
# Apply existing migrations
docker-compose exec nur-api python manage.py migrate

# Create a migration after you change a model
docker-compose exec nur-api python manage.py makemigrations

# Backup
docker exec db pg_dump -U postgres nur_db > backup.sql

# Restore
docker exec -i db psql -U postgres nur_db < backup.sql
```

Container start runs `migrate` only. It does not run `makemigrations`.

### Reset Everything

```bash
./reset-docker.sh
```

This deletes the CityScope database volume and the media volume. `reset-docker.ps1` does the same on Windows.

## Project Structure

```
nur-cityscope/
├── docker-compose.yml
├── nginx/                    # Reverse proxy config
├── nur-io/django_api/        # Django backend
├── nur-front/frontend/       # React dashboard
├── nur-projection/frontend/  # Projection display
└── nur-remote-controller/    # Presentation remote
```

The dashboard is built by `dashboard-builder`. After a dashboard code change, run `docker-compose up -d --build dashboard-builder`. Projection and the remote are mounted from the repo, so a refresh is enough. Nginx route changes need `docker-compose up -d --build nginx`.

## How It Works

1. **Initialization**: `nur-io/django_api/init.sh` runs on container start:
   - Applies database migrations
   - Creates the `idistrict` table and the Mobility and Climate indicators
   - Loads data from `nur-io/django_api/public/processed/` on first run
   - Creates the default admin user (admin/admin123)

2. **Frontend**: React app built by `dashboard-builder`, served via nginx at `/dashboard/`

3. **Backend**: Django API at `:9900` handles data, state, and WebSocket connections

4. **Projection**: Display pages synced via WebSocket for real-time updates

See individual module READMEs for details. See [AGENTS.md](AGENTS.md) before removing backend files. Migrations `0005` through `0036` still create the old Otef tables, and `0037_drop_otef_tables` drops them. The helper modules those migrations import have to stay.
