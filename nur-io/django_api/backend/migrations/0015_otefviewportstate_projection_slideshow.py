# Generated manually for projection slideshow cross-device sync

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0014_workshop_autopublish_suppression"),
    ]

    operations = [
        migrations.AddField(
            model_name="otefviewportstate",
            name="projection_slideshow",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
