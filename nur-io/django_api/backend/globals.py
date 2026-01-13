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

# Presentation mode state per table (shared across tabs via backend)
# Structure: {
#   'table_name': {
#       'is_playing': False,
#       'sequence': [...],
#       'sequence_index': 0,
#       'duration': 10
#   }
# }
PRESENTATION_STATE_BY_TABLE = {}

# Default presentation state structure
DEFAULT_PRESENTATION_STATE = {
    "is_playing": False,
    "sequence": [
        {"indicator": "mobility", "state": "Present"},
        {"indicator": "climate", "state": "Existing"},
    ],
    "sequence_index": 0,
    "duration": 10,
}

# Default table name for legacy code
DEFAULT_TABLE_NAME = "idistrict"

# Helper function to get presentation state for a table
def get_presentation_state(table_name=None):
    """Get presentation state for a specific table, creating default if needed"""
    if table_name is None:
        table_name = DEFAULT_TABLE_NAME
    if table_name not in PRESENTATION_STATE_BY_TABLE:
        PRESENTATION_STATE_BY_TABLE[table_name] = {
            "is_playing": DEFAULT_PRESENTATION_STATE["is_playing"],
            "sequence": DEFAULT_PRESENTATION_STATE["sequence"].copy(),
            "sequence_index": DEFAULT_PRESENTATION_STATE["sequence_index"],
            "duration": DEFAULT_PRESENTATION_STATE["duration"],
        }
    return PRESENTATION_STATE_BY_TABLE[table_name]

# Legacy variables for backward compatibility (use default table)
# These are maintained for code that hasn't been updated yet
PRESENTATION_PLAYING = False
PRESENTATION_SEQUENCE = [
    {"indicator": "mobility", "state": "Present"},
    {"indicator": "climate", "state": "Existing"},
]
PRESENTATION_SEQUENCE_INDEX = 0
PRESENTATION_DURATION = 10

# Initialize default table state
_default_state = get_presentation_state(DEFAULT_TABLE_NAME)
PRESENTATION_PLAYING = _default_state["is_playing"]
PRESENTATION_SEQUENCE = _default_state["sequence"]
PRESENTATION_SEQUENCE_INDEX = _default_state["sequence_index"]
PRESENTATION_DURATION = _default_state["duration"]


# Default states for fallback
DEFAULT_STATES = {"year": 2023, "scenario": "present", "label": "Present"}

# Default climate scenario state
DEFAULT_CLIMATE_STATE = {
    "scenario": "existing",
    "type": "utci",
    "label": "Existing - UTCI",
}
