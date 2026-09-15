from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("backend", "0020_otefprojectioncalibration")]

    operations = [
        migrations.AddField(
            model_name="otefviewportstate",
            name="escape_overlay",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
