import os
import json
from django.core.management.base import BaseCommand
from backend.models import Indicator

class Command(BaseCommand):
    help = 'Generates indicators from a JSON file located in sources/indicator_ids.json'

    def handle(self, *args, **options):
        # Clear existing indicators
        Indicator.objects.all().delete()
        
        # Determine the path to the JSON file relative to this command's directory
        base_dir = os.path.dirname(__file__)
        json_path = os.path.join(base_dir, 'sources', 'indicator_ids.json')
        
        # Load the JSON file
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except FileNotFoundError:
            self.stdout.write(self.style.ERROR('indicator_ids.json not found in sources/'))
            return
        except json.JSONDecodeError as e:
            self.stdout.write(self.style.ERROR(f'JSON parsing error: {e}'))
            return

        # Create indicators from the JSON data
        created_count = 0
        for item in data:
            indicator_id = int(item['id'])
            name = item['name']
            has_states = bool(item['states'])
            description = item.get('description', '')  # Optional description field
            
            # Create the indicator in the database
            Indicator.objects.create(
                indicator_id=indicator_id,
                name=name,
                has_states=has_states,
                description=description
            )
            created_count += 1

        self.stdout.write(self.style.SUCCESS(f'Created {created_count} indicators.'))

"""
HOW TO ADD OR MODIFY INDICATORS:

1. Edit the indicator_ids.json file in the sources directory:
   - Each indicator should have:
     * id: Unique integer identifier
     * name: Human-readable name
     * states: 1 for indicators that use the state system, 0 for static indicators
     * description: Optional description of the indicator

2. Example indicator entry:
   {
       "id": 3,
       "name": "New Indicator",
       "states": 1,
       "description": "Description of what this indicator measures"
   }

3. Run the command:
   python manage.py generate_indicators

4. For indicators with states (states: 1):
   - Create corresponding images in media/indicators/{id}/
   - Image names should be 7-digit binary numbers (0000000.png to 1111111.png)
   - Each binary digit represents a different state trait

5. For static indicators (states: 0):
   - Create a single image in media/indicators/{id}/
   - Image name can be any valid filename

Note: After adding new indicators, you may need to run:
- generate_states.py (if using states)
- generate_indicatorData.py
- generate_indicatorImages.py
"""
