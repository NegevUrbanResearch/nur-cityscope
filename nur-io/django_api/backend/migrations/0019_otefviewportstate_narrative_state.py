from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("backend", "0018_otefviewportstate_person_selection")]

    operations = [
        migrations.AddField(
            model_name="otefviewportstate",
            name="narrative_state",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
