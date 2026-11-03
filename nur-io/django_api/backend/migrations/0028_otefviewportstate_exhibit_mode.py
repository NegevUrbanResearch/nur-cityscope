from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('backend', '0027_projection_config_v5'),
    ]

    operations = [
        migrations.AddField(
            model_name='otefviewportstate',
            name='exhibit_mode',
            field=models.BooleanField(default=False),
        ),
    ]
