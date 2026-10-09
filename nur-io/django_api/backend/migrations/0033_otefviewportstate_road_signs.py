from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("backend", "0032_otefviewportstate_gaza_border_visible")]

    operations = [
        migrations.AddField(
            model_name="otefviewportstate",
            name="road_sign_settings",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="otefviewportstate",
            name="road_sign_revision",
            field=models.PositiveBigIntegerField(default=0),
        ),
    ]
