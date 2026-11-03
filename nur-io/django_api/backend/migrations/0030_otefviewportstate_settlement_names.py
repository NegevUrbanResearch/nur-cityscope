from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0029_otefviewportstate_clock_legend_layout_revisions"),
    ]

    operations = [
        migrations.AddField(
            model_name="otefviewportstate",
            name="settlement_name_settings",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="otefviewportstate",
            name="settlement_name_revision",
            field=models.PositiveBigIntegerField(default=0),
        ),
    ]
