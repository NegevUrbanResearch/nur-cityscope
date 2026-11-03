from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("backend", "0021_otefviewportstate_escape_overlay")]

    operations = [
        migrations.AddField(
            model_name="otefviewportstate",
            name="nli_clock_layout",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
