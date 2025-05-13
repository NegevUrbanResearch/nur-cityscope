import os
import json
from django.core.management.base import BaseCommand
from backend.models import DashboardData

class Command(BaseCommand):
    help = 'Generates dashboard data entries from a JSON configuration file'

    def handle(self, *args, **options):
        # Clear existing dashboard data
        DashboardData.objects.all().delete()
        
        # Get the path to the JSON file
        base_dir = os.path.dirname(__file__)
        json_path = os.path.join(base_dir, 'sources', 'dashboard_config.json')
        
        # Load the JSON file
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except FileNotFoundError:
            self.stdout.write(self.style.ERROR('dashboard_config.json not found in sources/'))
            return
        except json.JSONDecodeError as e:
            self.stdout.write(self.style.ERROR(f'JSON parsing error: {e}'))
            return

        created_count = 0

        for item in data:
            # Create dashboard data entry
            DashboardData.objects.get_or_create(
                name=item['name'],
                description=item.get('description', ''),
                config=item.get('config', {})
            )
            created_count += 1

        self.stdout.write(self.style.SUCCESS(f'Created {created_count} dashboard data entries.'))

"""
HOW DASHBOARD DATA WORKS:

1. Configuration Structure:
   - Dashboard data is configured in dashboard_config.json
   - Each entry has a name, description, and config object
   - Config object contains display settings and layout info

2. Data Usage:
   - Used to configure the dashboard layout
   - Controls indicator grouping and display order
   - Manages dashboard sections and their properties

3. Configuration Example:
   {
     "name": "Mobility",
     "description": "Urban mobility indicators",
     "config": {
       "layout": "grid",
       "indicators": ["bike_lanes", "public_transport"],
       "display": {
         "show_legend": true,
         "show_tooltip": true
       }
     }
   }

Note: This command should be run after:
- generate_indicators.py (to ensure indicators exist)
"""
