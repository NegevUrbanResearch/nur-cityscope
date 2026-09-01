from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("backend", "0017_otefviewportstate_investigation_clock")]

    operations = [
        migrations.AddField(
            model_name="otefviewportstate",
            name="person_selection",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
