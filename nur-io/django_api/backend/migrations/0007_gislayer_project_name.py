from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('backend', '0006_otefviewportstate_animations_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='gislayer',
            name='project_name',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AlterUniqueTogether(
            name='gislayer',
            unique_together={('table', 'name', 'project_name')},
        ),
    ]
