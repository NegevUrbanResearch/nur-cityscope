## Public data directory

Store real datasets here to be loaded on startup by the `create_data` command (preferred). A legacy alias `create_sample_data` remains for backward compatibility. The loader will prefer real assets and synthesize only what is missing.

### Folder structure

```
public/
  processed/
    mobility/
      present/
        image/
          any-image.{png|jpg|jpeg|gif|svg}
        map/
          any-map.html
        geojson/ (optional)
          any.geojson.json
        dashboard.json (optional)
      projected/ (optional)
        image/
        map/
        geojson/
        dashboard.json
    climate/ (optional)
      present/
        image/
        map/
        geojson/
        dashboard.json
      projected/
        ...
    land_use/ (optional)
      present/
      projected/
  raw/ (optional)
```

### Conventions

- Scenario subfolders: `present` maps to the current state (scenario: current). `projected` maps to the future state (scenario: projected).
- File names inside `image/` and `map/` are flexible; the loader picks the first matching file. The system copies them into `MEDIA_ROOT` using canonical names: `indicators/<category>/<indicator_name>_<year>.<ext>` for images and `maps/<indicator_name_without_spaces>_<year>.html` for maps.
- If `geojson/` has a `.json` file, it will be stored into `IndicatorGeojson` for that indicator/state.
- If `dashboard.json` exists, it will be used to populate `DashboardFeedState` for that dashboard type and state; otherwise a synthetic dashboard is generated.

### Minimum requirement to override synthetic content

- To show a real map: place one `.html` file in `processed/<category>/<scenario>/map/`.
- To show a real image: place one image file in `processed/<category>/<scenario>/image/`.
- To load real GeoJSON: place one `.json` file in `processed/<category>/<scenario>/geojson/` with a FeatureCollection.

### Notes

- The management command will clean and recreate records. Ensure your `public/processed/` holds all files you wish to load.
- Permissions are fixed to 0644 on copied files.
