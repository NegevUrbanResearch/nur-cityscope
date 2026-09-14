from django.db import migrations, models
import backend.models


class Migration(migrations.Migration):
    dependencies = [("backend", "0019_otefviewportstate_narrative_state")]

    operations = [
        migrations.CreateModel(
            name="OTEFProjectionCalibration",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("working_config", models.JSONField(default=backend.models.projection_config_defaults)),
                ("revision", models.PositiveBigIntegerField(default=0)),
                ("presets", models.JSONField(default=backend.models.projection_presets_defaults)),
                ("selected_preset_id", models.CharField(default="original", max_length=64)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("table", models.OneToOneField(on_delete=models.deletion.CASCADE, related_name="projection_calibration", to="backend.table")),
            ],
        ),
    ]
