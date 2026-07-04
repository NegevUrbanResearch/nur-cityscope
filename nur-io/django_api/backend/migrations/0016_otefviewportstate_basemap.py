from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0015_otefviewportstate_projection_slideshow"),
    ]

    operations = [
        migrations.AddField(
            model_name="otefviewportstate",
            name="basemap",
            field=models.CharField(default="osm", max_length=16),
        ),
    ]
