import logging

from django.db import migrations


logger = logging.getLogger(__name__)


def migrate_projection_configs(apps, schema_editor):
    from backend.projection_config_migration import convert_projection_calibration_payload_to_v4

    model = apps.get_model('backend', 'OTEFProjectionCalibration')
    db_alias = schema_editor.connection.alias
    rows = list(model.objects.using(db_alias).select_for_update().all().order_by('pk'))
    converted = []
    notices = []
    for row in rows:
        row_notices = []
        working_config, presets = convert_projection_calibration_payload_to_v4(
            row.working_config, row.presets, row.selected_preset_id, row.revision,
            row_notices,
        )
        converted.append((row, working_config, presets))
        notices.extend((row.pk, notice) for notice in row_notices)
    for row, working_config, presets in converted:
        row.working_config = working_config
        row.presets = presets
    if converted:
        model.objects.using(db_alias).bulk_update([row for row, _, _ in converted], ['working_config', 'presets'])
    for row_id, notice in notices:
        logger.warning('Projection calibration %s conversion notice: %s', row_id, notice)


class Migration(migrations.Migration):
    atomic = True
    dependencies = [('backend', '0025_projection_config_v3')]
    operations = [migrations.RunPython(migrate_projection_configs, migrations.RunPython.noop)]
