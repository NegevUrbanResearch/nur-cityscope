from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("backend", "0031_projection_config_v7")]

    operations = [
        migrations.AddField(
            model_name="otefviewportstate",
            name="gaza_border_visible",
            field=models.BooleanField(default=False),
        ),
    ]
