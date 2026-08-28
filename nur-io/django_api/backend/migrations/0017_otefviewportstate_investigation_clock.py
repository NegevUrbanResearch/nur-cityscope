# Generated manually for NLI investigation clock cross-device sync

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0016_otefviewportstate_basemap"),
    ]

    operations = [
        migrations.AddField(
            model_name="otefviewportstate",
            name="investigation_clock",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
