from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0028_otefviewportstate_exhibit_mode"),
    ]

    operations = [
        migrations.AddField(
            model_name="otefviewportstate",
            name="nli_clock_layout_revision",
            field=models.PositiveBigIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="otefviewportstate",
            name="legend_layout_revision",
            field=models.PositiveBigIntegerField(default=0),
        ),
    ]
