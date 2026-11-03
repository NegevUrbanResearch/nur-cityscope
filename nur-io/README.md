# nur-CityScope backend

Django REST API and WebSocket for the iDistrict dashboard, projection display, and remote.

## Stack

- Django 4.2 and Django REST Framework
- Django Channels and Redis
- PostgreSQL
- Pillow, Pandas, and Matplotlib

## Layout

```text
django_api/
  core/                 project settings
  backend/
    models.py
    views.py
    serializers.py
    climate_scenarios.py
    management/commands/create_data.py
  websocket_app/        presentation WebSocket
  public/processed/     visualization files
  init.sh               container start
```

`init.sh` waits for Postgres, runs `migrate`, and ensures the `idistrict` table plus the Mobility and Climate indicators. On the first start it runs `create_data` and creates the admin user `admin` with password `admin123`. It then copies `public/processed/mobility` and `public/processed/climate` into the media volume.

`init.sh` does not run `makemigrations`.

## Models

- **Table** groups indicators. The shipped table name is `idistrict`.
- **Indicator** is a metric on a table. The categories are `mobility` and `climate`.
- **State** is a scenario or a time period for an indicator.
- **IndicatorData** links an indicator to a state.
- **IndicatorImage** stores the image, video, or HTML map for that pair.
- **DashboardFeedState** stores chart data.
- **LayerConfig** stores Deck.gl layer settings.

Queries that select an indicator by `indicator_id` need `?table=idistrict`. The same `indicator_id` can exist on another table.

## API

```text
GET  /api/tables/
GET  /api/indicators/?table=idistrict
GET  /api/states/
GET  /api/indicator_data/
GET  /api/indicator_images/
POST /api/indicator_images/
GET  /api/dashboard_feed_state/?dashboard_type=mobility
GET  /api/layer_config/

GET  /api/actions/get_global_variables/
GET  /api/actions/get_image_data/?table=idistrict
GET  /api/actions/get_deckgl_data/
GET  /api/actions/get_file_hierarchy/
GET  /api/actions/get_presentation_state/
POST /api/actions/set_current_indicator/
POST /api/actions/set_climate_scenario/
POST /api/actions/set_visualization_mode/
POST /api/actions/set_presentation_state/
```

The presentation WebSocket is `/ws/presentation/`.

The dashboard upload page writes indicators, states, indicator data, and indicator images. It reads the file list from `get_file_hierarchy`.

Admin is http://localhost:9900/admin.

## Commands

Run these inside `nur-api`.

```bash
docker exec nur-api python manage.py migrate
docker exec nur-api python manage.py create_data
docker exec nur-api python manage.py makemigrations
```

Run `makemigrations` only after a model change.

## Migrations that must stay

Keep `backend/migrations/`. A new database replays every file, including `0037_drop_otef_tables`.

These modules stay because those migrations import them. The list and the reason are in the repository root [AGENTS.md](../AGENTS.md).

- `projection_config_migration.py`
- `projection_config_schema.py`
- `projection_warp_schema.py`
- `projection_baseline_manifest.py`
- `nli_font_settings.py`
- `projection_config_defaults` and `projection_presets_defaults` in `models.py`
