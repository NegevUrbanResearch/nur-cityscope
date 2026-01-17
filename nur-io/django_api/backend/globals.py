"""
Global variables for storing state between requests and modules.
These variables are used to track the current state of the application
and will be passed between the API and WebSocket server.
"""

# Indicator state per table (allows multiple tabs with different tables)
# Structure: {
#   'table_name': {
#       'indicator_id': 1,
#       'indicator_state': {...},
#       'visualization_mode': 'image'
#   }
# }
INDICATOR_STATE_BY_TABLE = {}

# Default indicator state structure
DEFAULT_INDICATOR_STATE = {
    "indicator_id": 1,
    "indicator_state": {"year": 2023, "scenario": "present", "label": "Present"},
    "visualization_mode": "image"
}

# Default table name for legacy code (defined early so it can be used below)
DEFAULT_TABLE_NAME = "idistrict"

# Legacy global variables for backward compatibility (use default table)
# These are maintained for code that hasn't been updated yet
INDICATOR_ID = 1
INDICATOR_STATE = {"year": 2023, "scenario": "present", "label": "Present"}
VISUALIZATION_MODE = "image"

# Helper function to get indicator state for a table
def get_indicator_state(table_name=None):
    """Get indicator state for a specific table, creating default if needed"""
    if table_name is None:
        table_name = DEFAULT_TABLE_NAME
    if table_name not in INDICATOR_STATE_BY_TABLE:
        INDICATOR_STATE_BY_TABLE[table_name] = {
            "indicator_id": DEFAULT_INDICATOR_STATE["indicator_id"],
            "indicator_state": DEFAULT_INDICATOR_STATE["indicator_state"].copy(),
            "visualization_mode": DEFAULT_INDICATOR_STATE["visualization_mode"],
        }
    return INDICATOR_STATE_BY_TABLE[table_name]

# Initialize default table state
_default_indicator = get_indicator_state(DEFAULT_TABLE_NAME)
INDICATOR_ID = _default_indicator["indicator_id"]
INDICATOR_STATE = _default_indicator["indicator_state"]
VISUALIZATION_MODE = _default_indicator["visualization_mode"]

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
