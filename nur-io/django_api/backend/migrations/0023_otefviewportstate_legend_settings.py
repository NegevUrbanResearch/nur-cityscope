from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("backend", "0022_otefviewportstate_nli_clock_layout")]

    operations = [
        migrations.AddField(
            model_name="otefviewportstate",
            name="legend_settings",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
