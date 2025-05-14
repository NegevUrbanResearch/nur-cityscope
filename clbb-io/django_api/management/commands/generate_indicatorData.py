import os
import json
from django.core.management.base import BaseCommand
from backend.models import Indicator, State, IndicatorData

class Command(BaseCommand):
    help = 'Generates indicator data entries linking indicators with their states'

    def handle(self, *args, **options):
        # Clear existing indicator data
        IndicatorData.objects.all().delete()
        
        # Get the path to the JSON file
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

        created_count = 0

        for item in data:
            # Get states based on whether the indicator uses the state system
            if item['states']:
                # For indicators with states, get all possible state combinations
                states = State.objects.exclude(state_values={})
            else:
                # For static indicators, use a single empty state
                states, created = State.objects.get_or_create(state_values={})
                states = [states]
            
            # Get the indicator object
            indicator = Indicator.objects.filter(indicator_id=item['id']).first()
            
            # Create data entries for each state
            states = list(states)
            for state in states:
                IndicatorData.objects.get_or_create(indicator=indicator, state=state)
                created_count += 1

        self.stdout.write(self.style.SUCCESS(f'Created {created_count} indicator data entries.'))

"""
HOW INDICATOR DATA WORKS:

1. For indicators with states (states: 1):
   - Creates data entries for all 128 possible state combinations
   - Each entry links an indicator with a specific state
   - Used for dynamic indicators that change based on state

2. For static indicators (states: 0):
   - Creates a single data entry with an empty state
   - Used for indicators that don't change based on state

3. The data entries are used to:
   - Link indicators with their states
   - Store images for each state
   - Store GeoJSON data for each state
   - Configure layer display settings

Note: This command should be run after:
- generate_states.py (to create all possible states)
- generate_indicators.py (to create the indicators)
"""
