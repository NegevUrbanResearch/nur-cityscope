"""
Global variables for storing state between requests and modules.
These variables are used to track the current state of the application
and will be passed between the API and WebSocket server.
"""

# Current indicator ID being displayed
INDICATOR_ID = 1

# Current state of the indicator (year, parameters, etc.)
# For climate indicator: {'scenario': 'existing', 'type': 'utci', 'label': 'Existing - UTCI'}
# For other indicators: {'year': 2023, 'scenario': 'present', 'label': 'Present'}
INDICATOR_STATE = {"year": 2023, "scenario": "present", "label": "Present"}

# Visualization mode (image or map)
VISUALIZATION_MODE = "image"

# Presentation mode state (shared across tabs via backend)
PRESENTATION_PLAYING = False
PRESENTATION_SEQUENCE = [
    {"indicator": "mobility", "state": "Present"},
    {"indicator": "climate", "state": "Existing"},
]
PRESENTATION_SEQUENCE_INDEX = 0
PRESENTATION_DURATION = 10

# Default states for fallback
DEFAULT_STATES = {"year": 2023, "scenario": "present", "label": "Present"}

# Default climate scenario state
DEFAULT_CLIMATE_STATE = {
    "scenario": "existing",
    "type": "utci",
    "label": "Existing - UTCI",
}
