"""
Climate scenario configuration and mapping.
This module defines the 7 climate scenarios and their UTCI/Plan map pairs.
"""

# Mapping between UTCI and Plan scenarios
CLIMATE_SCENARIO_MAPPING = {
    "dense_highrise": {
        "display_name": "Dense Highrise",
        "utci_image": "Dense-Highrise.jpg",
        "plan_image": "dense high plan.jpg",
        "description": "High-density development with tall buildings",
    },
    "existing": {
        "display_name": "Existing",
        "utci_image": "Existing.jpg",
        "plan_image": "Existing-Plan.jpg",
        "description": "Current existing conditions",
    },
    "high_rises": {
        "display_name": "High Rises",
        "utci_image": "High-Rises.jpg",
        "plan_image": "high rise plan.jpg",
        "description": "High-rise tower development",
    },
    "lowrise": {
        "display_name": "Low Rise Dense",
        "utci_image": "Lowrise.jpg",
        "plan_image": "dense low plan.jpg",
        "description": "Low-rise dense development",
    },
    "mass_tree_planting": {
        "display_name": "Mass Tree Planting",
        "utci_image": "Mass Tree Planting.jpg",
        "plan_image": "Mass Tree Plan.jpg",
        "description": "Extensive tree planting strategy",
    },
    "open_public_space": {
        "display_name": "Open Public Space",
        "utci_image": "OpenPublicSpace.jpg",
        "plan_image": "Public Space Plan.jpg",
        "description": "Maximized public open spaces",
    },
    "placemaking": {
        "display_name": "Placemaking",
        "utci_image": "Placemaking.jpg",
        "plan_image": "Placemaking Plan.jpg",
        "description": "Community-focused placemaking approach",
    },
}

# Default scenario when climate indicator is first loaded
DEFAULT_CLIMATE_SCENARIO = "existing"
DEFAULT_CLIMATE_TYPE = "utci"


def get_scenario_list():
    """Returns list of scenario keys in order"""
    return list(CLIMATE_SCENARIO_MAPPING.keys())


def get_display_names():
    """Returns dict of scenario keys to display names"""
    return {k: v["display_name"] for k, v in CLIMATE_SCENARIO_MAPPING.items()}


def get_paired_scenario(scenario_key, current_type):
    """
    Get the corresponding scenario state for the opposite type.

    Args:
        scenario_key: The scenario identifier (e.g., 'existing')
        current_type: Current type ('utci' or 'plan')

    Returns:
        The opposite type ('plan' if current is 'utci', vice versa)
    """
    return "plan" if current_type == "utci" else "utci"


def get_image_filename(scenario_key, scenario_type):
    """
    Get the image filename for a given scenario and type.

    Args:
        scenario_key: The scenario identifier
        scenario_type: 'utci' or 'plan'

    Returns:
        Image filename or None if not found
    """
    scenario = CLIMATE_SCENARIO_MAPPING.get(scenario_key)
    if not scenario:
        return None

    return scenario.get(f"{scenario_type}_image")
