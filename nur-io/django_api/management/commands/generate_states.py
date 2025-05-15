from django.core.management.base import BaseCommand
from backend.models import State

class Command(BaseCommand):
    help = 'Generates all 128 possible state combinations (0/1) for keys "1" through "7"'

    def handle(self, *args, **options):
        keys = [str(i) for i in range(1, 8)]  # ["1", "2", "3", "4", "5", "6", "7"]

        # Clear existing states (optional, only if we want to clean up first)
        State.objects.all().delete()

        created_count = 0
        # 2^7 = 128 combinations
        for num in range(128):
            # Convert to binary with 7-digit padding
            binary_str = format(num, '07b')
            state_dict = {keys[i]: int(binary_str[i]) for i in range(7)}

            # Create and save the instance
            State.objects.create(state_values=state_dict)
            created_count += 1

        self.stdout.write(self.style.SUCCESS(f'Created {created_count} state combinations.'))

"""
STATE SYSTEM EXPLANATION:

The system uses 7 binary traits that can be combined in 128 different ways (2^7).
Each state is represented by a 7-digit binary number (0000000 to 1111111).

Example state combinations:
- 0000000: All traits off
- 0000001: Only trait 7 on
- 0000010: Only trait 6 on
- 1111111: All traits on

Each trait (1-7) can be interpreted as needed, for example:
1. Time period (current/future)
2. Season (summer/winter)
3. Weather condition (sunny/rainy)
4. Traffic level (low/high)
5. Population density (low/high)
6. Infrastructure status (existing/planned)
7. Environmental condition (good/poor)

To use a specific state combination:
1. Find the binary representation (e.g., 1010101)
2. Convert to decimal (85 in this case)
3. Use that number to reference the state

The state values are stored in the database as JSON objects:
{
    "1": 1,  # Trait 1 is on
    "2": 0,  # Trait 2 is off
    "3": 1,  # Trait 3 is on
    "4": 0,  # Trait 4 is off
    "5": 1,  # Trait 5 is on
    "6": 0,  # Trait 6 is off
    "7": 1   # Trait 7 is on
}
"""
