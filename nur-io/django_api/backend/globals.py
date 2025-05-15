"""
Global variables for storing state between requests and modules.
These variables are used to track the current state of the application
and will be passed between the API and WebSocket server.
"""

# Current indicator ID being displayed
INDICATOR_ID = 1

# Current state of the indicator (year, parameters, etc.)
INDICATOR_STATE = {'year': 2023, 'scenario': 'current', 'label': 'Current State'}

# Temporary list for tracking state changes
list_temp = []

# Visualization mode (image or map)
VISUALIZATION_MODE = 'image'

# Default states for fallback
DEFAULT_STATES = {'year': 2023, 'scenario': 'current', 'label': 'Current State'}

# Mapping of RFID tags to state values
SLOTS_IDS = {
    '1001': ('year', 2025),
    '1002': ('year', 2030),
    '1003': ('year', 2040),
}

# RFID tag processing
buffer_interface = []

# Mapping of RFID tags to (slot, state) pairs
# Used by the remote controller
SLOTS_IDS_PAIRS = {
    '13': (1, 0),
    '14': (2, 0),
    '15': (3, 0),
    '16': (4, 0),
    '17': (5, 0),
    '18': (6, 0),
    '19': (7, 0),
    '20': (1, 1),
    '21': (2, 1),
    '22': (3, 1),
    '23': (4, 1),
    '24': (5, 1),
    '25': (6, 1),
    '26': (7, 1),
}