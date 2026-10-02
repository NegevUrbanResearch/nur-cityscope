from django.db import migrations


def upgrade_projection_config_rows(apps, schema_editor):
    from backend.projection_config_migration import convert_projection_calibration_payload_to_v7

    model = apps.get_model('backend', 'OTEFProjectionCalibration')
    database = schema_editor.connection.alias
    pending = []
    for row in model.objects.using(database).order_by('pk').iterator():
        working, presets = convert_projection_calibration_payload_to_v7(
            row.working_config, row.presets, row.selected_preset_id, row.revision,
        )
        pending.append((row.pk, working, presets))
    for pk, working, presets in pending:
        model.objects.using(database).filter(pk=pk).update(working_config=working, presets=presets)


class Migration(migrations.Migration):
    dependencies = [
        ('backend', '0030_otefviewportstate_settlement_names'),
    ]

    operations = [
        migrations.RunPython(upgrade_projection_config_rows, migrations.RunPython.noop),
    ]
