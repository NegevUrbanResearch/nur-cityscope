# CityScope

This repository is the iDistrict dashboard, the projection display, and the presentation remote.

OTEF Interactive is a separate project at https://github.com/NegevUrbanResearch/Otef_interactive. Do not add Otef routes, mounts, or setup steps here.

## Run

Copy `.env.example` to `.env`. Set `POSTGRES_PASSWORD` and `REACT_APP_MAPBOX_ACCESS_TOKEN`.

If port 80 is already in use, set `FRONT_PORT` to a free port before you start.

```bash
docker-compose up -d --build
```

Open `http://localhost:<FRONT_PORT>/`. nginx redirects `/` to `/dashboard/`.

`init.sh` runs `migrate` when `nur-api` starts. It does not run `makemigrations`. On the first start it also runs `create_data` and creates the admin user `admin` with password `admin123`.

## Where code lives

- `nur-front/frontend` is the React dashboard. nginx serves the built files at `/dashboard/`. Rebuild `dashboard-builder` after a source change.
- `nur-projection/frontend` is the projection page at `/projection/`. Compose bind-mounts it.
- `nur-remote-controller/frontend` is the remote at `/remote-controller/`. `/remote` redirects there. Compose bind-mounts it.
- `nur-io/django_api` is the Django API and the WebSocket at `/ws/presentation/`.
- `nginx/default.conf.template` is the route map. The nginx image copies that file, so a route change needs `docker-compose up -d --build nginx`.
- The Postgres container name is `db`. The database name is `nur_db`.

## Leave these files in place

Keep every file in `nur-io/django_api/backend/migrations/`. A new database replays them. Migrations `0005` through `0036` create the old Otef tables. `0037_drop_otef_tables` drops those tables and deletes a `Table` row named `otef`.

These modules stay because those migrations import them.

- `nur-io/django_api/backend/projection_config_migration.py`
- `nur-io/django_api/backend/projection_config_schema.py`
- `nur-io/django_api/backend/projection_warp_schema.py`
- `nur-io/django_api/backend/projection_baseline_manifest.py`
- `nur-io/django_api/backend/nli_font_settings.py`
- `projection_config_defaults` and `projection_presets_defaults` in `nur-io/django_api/backend/models.py`

`projection_warp_schema.py` still contains a default asset id that starts with `otef-`. That string is part of the migration default. It is not a route.

## Data

`create_data` reads `nur-io/django_api/public/processed/`. `init.sh` copies `climate` and `mobility` into the media volume.

Do not run `reset-docker.ps1` or `reset-docker.sh` unless you mean to delete the CityScope database volume.
