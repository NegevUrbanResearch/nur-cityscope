import os
from django.core.management.base import BaseCommand
from backend.models import IndicatorData, IndicatorImage

class Command(BaseCommand):
    help = 'Generates image entries for each indicator data state'

    def handle(self, *args, **options):
        # Clear existing indicator images
        IndicatorImage.objects.all().delete()
        
        # Get all indicator data entries
        indicator_data = IndicatorData.objects.all()
        
        created_count = 0
        
        for data in indicator_data:
            # Create image entry for each indicator data
            IndicatorImage.objects.get_or_create(indicator_data=data)
            created_count += 1

        self.stdout.write(self.style.SUCCESS(f'Created {created_count} indicator image entries.'))

"""
HOW INDICATOR IMAGES WORK:

1. Image Structure:
   - Each indicator data state gets one image entry
   - Images are stored in the media directory
   - Path format: media/indicators/{indicator_id}/{state_hash}.png

2. Image Generation:
   - Images are generated based on indicator type
   - Each state combination has a unique image
   - Images are stored in the IndicatorImage model

3. Image Usage:
   - Used in the dashboard to display indicator visualizations
   - Each state combination shows a different image
   - Images are linked to specific indicator data entries

Note: This command should be run after:
- generate_states.py (to create all possible states)
- generate_indicators.py (to create the indicators)
- generate_indicatorData.py (to create the data entries)
"""

