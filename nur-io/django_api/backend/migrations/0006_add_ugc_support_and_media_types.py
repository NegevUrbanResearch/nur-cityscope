# Generated manually for UGC support and media types

from django.db import migrations, models
import backend.models


class Migration(migrations.Migration):

    dependencies = [
        ('backend', '0005_table_indicator_backend_ind_table_i_1c5688_idx_and_more'),
    ]

    operations = [
        # Add is_user_generated field to Indicator model
        migrations.AddField(
            model_name='indicator',
            name='is_user_generated',
            field=models.BooleanField(
                default=False,
                help_text='Whether this indicator was created by a user (vs preloaded system data)'
            ),
        ),
        # Add is_user_generated field to State model
        migrations.AddField(
            model_name='state',
            name='is_user_generated',
            field=models.BooleanField(
                default=False,
                help_text='Whether this state was created by a user (vs preloaded system data)'
            ),
        ),
        # Add media_type field to IndicatorImage model
        migrations.AddField(
            model_name='indicatorimage',
            name='media_type',
            field=models.CharField(
                choices=[
                    ('image', 'Image'),
                    ('video', 'Video'),
                    ('html_map', 'HTML Map'),
                    ('deckgl_layer', 'Deck.GL Layer'),
                ],
                default='image',
                help_text='Type of media file (image, video, html_map, deckgl_layer)',
                max_length=20,
            ),
        ),
        # Change IndicatorImage.image from ImageField to FileField
        migrations.AlterField(
            model_name='indicatorimage',
            name='image',
            field=models.FileField(upload_to=backend.models.indicator_media_path),
        ),
    ]
