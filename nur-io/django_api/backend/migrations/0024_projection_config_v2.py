from django.db import migrations


def migrate_projection_configs(apps, schema_editor):
    from backend.projection_config_migration import convert_projection_calibration_payload

    model = apps.get_model('backend', 'OTEFProjectionCalibration')
    db_alias = schema_editor.connection.alias
    rows = list(model.objects.using(db_alias).select_for_update().all().order_by('pk'))
    converted = []
    for row in rows:
        working_config, presets = convert_projection_calibration_payload(
            row.working_config, row.presets, row.selected_preset_id, row.revision,
        )
        converted.append((row, working_config, presets))
    for row, working_config, presets in converted:
        row.working_config = working_config
        row.presets = presets
    if converted:
        model.objects.using(db_alias).bulk_update([row for row, _, _ in converted], ['working_config', 'presets'])


class Migration(migrations.Migration):
    atomic = True
    dependencies = [('backend', '0023_otefviewportstate_legend_settings')]
    operations = [migrations.RunPython(migrate_projection_configs, migrations.RunPython.noop)]
