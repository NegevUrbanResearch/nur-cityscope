from django.shortcuts import render
from django.db import models
from django.http import JsonResponse
from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action
import json
import os
from django.conf import settings
from datetime import datetime

from .models import (
    Indicator,
    IndicatorData,
    IndicatorImage,
    IndicatorGeojson,
    State,
    DashboardFeedState,
    LayerConfig,
    MapType,
)

from .serializers import (
    IndicatorSerializer,
    IndicatorDataSerializer,
    IndicatorImageSerializer,
    IndicatorGeojsonSerializer,
    StateSerializer,
    DashboardFeedStateSerializer,
    StateSerializer,
    LayerConfigSerializer,
    MapTypeSerializer,
)


class IndicatorViewSet(viewsets.ModelViewSet):
    serializer_class = IndicatorSerializer

    def get_queryset(self):
        return Indicator.objects.all()


class StateViewSet(viewsets.ModelViewSet):
    queryset = State.objects.all()
    serializer_class = StateSerializer


class IndicatorDataViewSet(viewsets.ModelViewSet):
    queryset = IndicatorData.objects.all()
    serializer_class = IndicatorDataSerializer


class IndicatorImageViewSet(viewsets.ModelViewSet):
    queryset = IndicatorImage.objects.all()
    serializer_class = IndicatorImageSerializer


class IndicatorGeojsonViewSet(viewsets.ModelViewSet):
    queryset = IndicatorGeojson.objects.all()
    serializer_class = IndicatorGeojsonSerializer


class DashboardFeedStateViewSet(viewsets.ModelViewSet):
    serializer_class = DashboardFeedStateSerializer

    def get_queryset(self):
        """
        Filter dashboard feed states by dashboard_type query parameter.
        Returns all dashboard feed states if no filter is specified.
        """
        queryset = DashboardFeedState.objects.all()

        # Filter by dashboard_type if provided in query params
        dashboard_type = self.request.query_params.get("dashboard_type", None)
        if dashboard_type:
            queryset = queryset.filter(dashboard_type=dashboard_type)

        return queryset


class LayerConfigViewSet(viewsets.ModelViewSet):
    queryset = LayerConfig.objects.all()
    serializer_class = LayerConfigSerializer


class MapTypeViewSet(viewsets.ModelViewSet):
    queryset = MapType.objects.all()
    serializer_class = MapTypeSerializer


# Now lets program the views for the API as an interactive platform

from . import globals
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync


class CustomActionsViewSet(viewsets.ViewSet):
    """
    ViewSet for custom actions, including state management for indicators
    and dashboard data retrieval.
    """

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Initialize the state if it's empty
        self._initialize_default_state()

    def _initialize_default_state(self):
        """Set up default state values if none are present"""
        if not globals.INDICATOR_STATE:
            try:
                # Try to get the default state from the database
                print(
                    f"Looking for default state with values: {globals.DEFAULT_STATES}"
                )

                # First attempt: exact match
                state = State.objects.filter(
                    state_values=globals.DEFAULT_STATES
                ).first()

                # Second attempt: match just the year and scenario
                if not state:
                    print("Exact match not found, trying partial match...")
                    year = globals.DEFAULT_STATES.get("year")
                    scenario = globals.DEFAULT_STATES.get("scenario")
                    states = State.objects.all()
                    for s in states:
                        if (
                            s.state_values.get("year") == year
                            and s.state_values.get("scenario") == scenario
                        ):
                            state = s
                            print(f"Found partial match: {s.state_values}")
                            break

                # Third attempt: get the first state
                if not state:
                    print("No matching state found, using first available state")
                    state = State.objects.first()

                if state:
                    globals.INDICATOR_STATE = state.state_values
                    print(f"Initialized state: {globals.INDICATOR_STATE}")
                else:
                    # Fallback to using the default state values directly
                    globals.INDICATOR_STATE = globals.DEFAULT_STATES
                    print(
                        f"No states in database. Using fallback default: {globals.INDICATOR_STATE}"
                    )
            except Exception as e:
                print(f"Error initializing default state: {e}")
                # Minimal fallback
                globals.INDICATOR_STATE = {"year": 2023}

    def check_and_send_data(self):
        # Si la condición es válida, enviamos los datos a los consumidores
        channel_layer = get_channel_layer()
        message = {
            "indicator_id": globals.INDICATOR_ID,
            "indicator_state": globals.INDICATOR_STATE,
            "visualization_mode": globals.VISUALIZATION_MODE,
        }
        print(message)

    @action(detail=False, methods=["get"])
    def get_global_variables(self, request):
        return JsonResponse(
            {
                "indicator_id": globals.INDICATOR_ID,
                "indicator_state": globals.INDICATOR_STATE,
                "visualization_mode": globals.VISUALIZATION_MODE,
            }
        )

    @action(detail=False, methods=["post"])
    def set_visualization_mode(self, request):
        """Set the visualization mode (image or map)"""
        mode = request.data.get("mode", "image")

        if mode not in ["image", "map"]:
            return JsonResponse(
                {
                    "status": "error",
                    "message": 'Invalid mode. Must be "image" or "map"',
                },
                status=400,
            )

        globals.VISUALIZATION_MODE = mode
        self.check_and_send_data()

        return JsonResponse({"status": "ok", "visualization_mode": mode})

    @action(detail=False, methods=["post"])
    def set_current_indicator(self, request):
        indicator_id = request.data.get("indicator_id", "")
        if self._set_current_indicator(indicator_id):
            return JsonResponse({"status": "ok", "indicator_id": indicator_id})
        else:
            return JsonResponse(
                {"status": "error", "message": "Failed to set current indicator"}
            )

    def _set_current_indicator(self, indicator_id):
        try:
            globals.INDICATOR_ID = indicator_id
            self.check_and_send_data()
            return True
        except Exception as e:
            print(e)
            return False

    @action(detail=False, methods=["post"])
    def set_current_state(self, request):
        state_id = request.data.get("state_id")
        try:
            state = State.objects.get(id=state_id)
            if self._set_current_state(state.state_values):
                return JsonResponse({"status": "ok", "state": state.state_values})
            else:
                return JsonResponse(
                    {"status": "error", "message": "Failed to set current state"}
                )
        except State.DoesNotExist:
            return JsonResponse(
                {"status": "error", "message": "State not found"}, status=404
            )
        except Exception as e:
            print(e)
            return JsonResponse({"status": "error", "message": str(e)}, status=500)

    def _set_current_state(self, state):
        try:
            globals.INDICATOR_STATE = state
            self.check_and_send_data()
            return True
        except Exception as e:
            print(e)
            return False

    @action(detail=False, methods=["get"], url_path="set_map_state")
    def receive_data_from_rfid(self, request):
        slots_param = request.GET.get("slots", "")
        # print('slots_param ', slots_param)
        keys = globals.INDICATOR_STATE.keys()
        # print('INDICATOR_STATE', globals.INDICATOR_STATE)
        print("list_temp", globals.list_temp)
        states = {f"{key}": 0 for key in keys}
        # print('states ', states)
        if slots_param:
            # print('globals.SLOTS_IDS', globals.SLOTS_IDS)
            rfid_tags = sorted(slots_param.split(","))
            # print('rfid_tags ', rfid_tags)

            # print('len(globals.list_temp)', len(globals.list_temp))
            # print('len(globals.INDICATOR_STATE)', len(globals.INDICATOR_STATE))
            if len(globals.list_temp) != len(globals.INDICATOR_STATE):
                # print(f'Number of tags reported: {len(rfid_tags)}')
                globals.list_temp += rfid_tags
                globals.list_temp = list(set(globals.list_temp))
                return JsonResponse(
                    {"status": "ok", "message": "RFID tag has been saved"}
                )
            else:
                print("All tags reported")
                for pos, rfid_tag in enumerate(globals.list_temp):
                    # print('rfid_tag ', rfid_tag)
                    if rfid_tag not in globals.SLOTS_IDS:
                        continue
                    else:
                        # print(globals.SLOTS_IDS[rfid_tag])
                        (SLOT, STATE) = globals.SLOTS_IDS[rfid_tag]
                        # print('SLOT ', SLOT)
                        # print('STATE ', STATE)
                        states[f"{SLOT}"] = STATE
                # print('states ', states)
                setted = self._set_current_state(states)
                globals.list_temp = []
                # print('setted ', setted)
                print("New state setted: ", globals.INDICATOR_STATE)
                if setted:
                    return JsonResponse({"status": "ok", "states": states})
                else:
                    return JsonResponse(
                        {"status": "error", "message": "Failed to set current state"}
                    )

    @action(detail=False, methods=["get"])
    def receive_data_from_buttons_page(self, request):
        print(request.body)
        if request.method == "GET":
            type_param = request.GET.get("map_type", 1)
            self._set_current_indicator(type_param)

    @action(detail=False, methods=["get"])
    def get_image_data(self, request):
        # Ensure we have a default state
        self._initialize_default_state()

        # Check if an indicator parameter was provided
        indicator_param = request.query_params.get("indicator")
        if indicator_param:
            # Map the indicator name to ID
            indicator_mapping = {"mobility": 1, "climate": 2, "land_use": 3}
            indicator_id = indicator_mapping.get(indicator_param)
            if indicator_id:
                globals.INDICATOR_ID = indicator_id
                print(
                    f"Using indicator from query parameter: {indicator_param} (ID: {indicator_id})"
                )

        # Debug information
        print(f"Current indicator_id: {globals.INDICATOR_ID}")
        print(f"Current state: {globals.INDICATOR_STATE}")
        print(f"Visualization mode: {globals.VISUALIZATION_MODE}")

        indicator = Indicator.objects.filter(indicator_id=globals.INDICATOR_ID)
        if not indicator.exists() or not indicator.first():
            # Default to the first available indicator
            indicator = Indicator.objects.first()
            if indicator:
                globals.INDICATOR_ID = indicator.indicator_id
                print(
                    f"Using fallback indicator: {indicator.name} (ID: {indicator.indicator_id})"
                )
            else:
                response = JsonResponse({"error": "No indicators found"}, status=404)
                self._add_no_cache_headers(response)
                return response

        indicator_obj = indicator.first()
        # Try to find a state matching the current indicator state
        if indicator_obj.has_states == False:
            state = State.objects.filter(state_values={})
        else:
            # Try exact match first
            state = State.objects.filter(state_values=globals.INDICATOR_STATE)

            # If no exact match, try matching just the year field
            if not state.exists():
                print(
                    f"No exact state match for {globals.INDICATOR_STATE}, trying year match..."
                )
                year = globals.INDICATOR_STATE.get("year")
                if year:
                    states = State.objects.all()
                    for s in states:
                        if s.state_values.get("year") == year:
                            state = State.objects.filter(id=s.id)
                            print(f"Found state with matching year: {s.state_values}")
                            break

        if not state.exists() or not state.first():
            # Default to the first available state
            state = State.objects.first()
            if state:
                globals.INDICATOR_STATE = state.state_values
                print(f"Using fallback state: {state.state_values}")
            else:
                response = JsonResponse({"error": "No states found"}, status=404)
                self._add_no_cache_headers(response)
                return response

        state_obj = state.first()
        indicator_data = IndicatorData.objects.filter(
            indicator=indicator_obj, state=state_obj
        )

        if not indicator_data.exists() or not indicator_data.first():
            # Try to find any indicator data for this indicator
            indicator_data = IndicatorData.objects.filter(indicator=indicator_obj)
            if indicator_data.exists():
                print(
                    f"Found alternative indicator data with state {indicator_data.first().state.state_values}"
                )
            else:
                print(f"No indicator data found for {indicator_obj.name}")
                response = JsonResponse(
                    {"error": "No indicator data found"}, status=404
                )
                self._add_no_cache_headers(response)
                return response

        # get_image_data should ALWAYS try to return static images first
        indicator_data_obj = indicator_data.first()
        image_data = IndicatorImage.objects.filter(indicatorData=indicator_data_obj)

        # Check if image_data exists and has a first element
        if image_data.exists() and image_data.first():
            try:
                image_path = image_data.first().image.name
                # Ensure the path has the indicators/ prefix if not already present
                if not image_path.startswith("indicators/"):
                    image_path = f"indicators/{image_path}"
                response = JsonResponse({"image_data": image_path, "type": "image"})
                self._add_no_cache_headers(response)
                return response
            except (AttributeError, ValueError) as e:
                print(f"Error with image data: {e}")
                # Continue to map fallback

        # If no static image is found, return an error
        response = JsonResponse(
            {
                "error": "No static image found for this indicator and state",
                "indicator": indicator_obj.name,
                "state": (
                    state_obj.state_values
                    if state_obj and hasattr(state_obj, "state_values")
                    else {}
                ),
            },
            status=404,
        )
        self._add_no_cache_headers(response)
        return response

    def _add_no_cache_headers(self, response):
        """Add cache control headers to prevent browser caching"""
        response["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response["Pragma"] = "no-cache"
        response["Expires"] = "0"
        return response

    @action(detail=False, methods=["get"])
    def get_geojson_data(self, request):
        indicator = Indicator.objects.filter(indicator_id=globals.INDICATOR_ID)
        if indicator.first().has_states == False:
            state = State.objects.filter(state_values={})
        else:
            state = State.objects.filter(state_values=globals.INDICATOR_STATE)

        indicator_data = IndicatorData.objects.filter(
            indicator=indicator.first(), state=state.first()
        )
        geojson_data = IndicatorGeojson.objects.filter(
            indicatorData=indicator_data.first()
        )
        return JsonResponse({"geojson_data": geojson_data.first().geojson})

    @action(detail=False, methods=["get"])
    def get_deckgl_data(self, request):
        """
        Process and serve data formatted for deck.gl visualization.
        This endpoint combines data processing (Python) with frontend rendering (deck.gl)
        """
        # Ensure we have a default state and initialize variables
        self._initialize_default_state()

        # Check if an indicator parameter was provided
        indicator_param = request.query_params.get("indicator")
        if indicator_param:
            # Map the indicator name to ID
            indicator_mapping = {"mobility": 1, "climate": 2, "land_use": 3}
            indicator_id = indicator_mapping.get(indicator_param)
            if indicator_id:
                globals.INDICATOR_ID = indicator_id
                print(
                    f"Using indicator from query parameter: {indicator_param} (ID: {indicator_id})"
                )

        # Get year from state or query param
        year = globals.INDICATOR_STATE.get("year", 2023)
        year_param = request.query_params.get("year")
        if year_param and year_param.isdigit():
            year = int(year_param)

        # Get the indicator and state
        indicator = Indicator.objects.filter(indicator_id=globals.INDICATOR_ID).first()
        if not indicator:
            response = JsonResponse(
                {"error": "Indicator not found", "indicator_id": globals.INDICATOR_ID},
                status=404,
            )
            return response

        # Get state based on indicator and year
        if indicator.has_states == False:
            state = State.objects.filter(state_values={}).first()
        else:
            # Try to find a state with the specified year
            state = None
            states = State.objects.all()
            for s in states:
                if s.state_values.get("year") == year:
                    state = s
                    break

            # If no state found with the year, use current indicator state
            if not state:
                state = State.objects.filter(
                    state_values=globals.INDICATOR_STATE
                ).first()

            # Fallback to any state if still not found
            if not state:
                state = State.objects.first()

        if not state:
            response = JsonResponse(
                {"error": "No valid state found", "year": year}, status=404
            )
            return response

        # Try to get existing indicator data
        indicator_data = IndicatorData.objects.filter(
            indicator=indicator, state=state
        ).first()

        if not indicator_data:
            response = JsonResponse(
                {
                    "error": "No data found for this indicator and state",
                    "indicator": indicator.name,
                    "state": (
                        state.state_values if hasattr(state, "state_values") else {}
                    ),
                },
                status=404,
            )
            return response

        # Check if there's a real HTML map available in LayerConfig
        layer_config = LayerConfig.objects.filter(indicatorData=indicator_data).first()
        if layer_config and layer_config.layer_config.get("mapUrl"):
            map_url = layer_config.layer_config["mapUrl"]
            # Check if this is an HTML file (real map) vs synthetic
            if map_url.endswith(".html") and os.path.exists(
                os.path.join(settings.MEDIA_ROOT, map_url)
            ):
                # Return HTML map URL for iframe display
                response = JsonResponse(
                    {
                        "type": "html_map",
                        "map_url": f"/media/{map_url}",
                        "metadata": {
                            "timestamp": datetime.now().isoformat(),
                            "year": year,
                            "indicator_type": indicator.category or "default",
                        },
                    }
                )
                self._add_no_cache_headers(response)
                return response

        # Fallback to synthetic deck.gl data generation
        indicator_type = indicator.category if indicator.category else "default"
        processed_data = self._process_data_for_deckgl(
            indicator_data, indicator_type, year
        )

        # Return processed data with cache control headers
        response = JsonResponse(
            processed_data, safe=False, json_dumps_params={"default": str}
        )
        self._add_no_cache_headers(response)
        return response

    def _process_data_for_deckgl(self, indicator_data, indicator_type, year):
        """Process data for different indicator types into deck.gl compatible format"""
        import numpy as np
        import json
        from datetime import datetime
        import random

        try:
            # Common bounds for all visualizations - can be overridden per indicator
            bounds = {
                "west": -74.056,
                "south": 40.6628,
                "east": -73.956,
                "north": 40.7628,
            }

            # Start with basic metadata
            result = {
                "metadata": {
                    "timestamp": datetime.now().isoformat(),
                    "year": year,
                    "bounds": bounds,
                    "indicator_type": indicator_type,
                }
            }

            # Try to load existing GeoJSON if available
            try:
                geojson = IndicatorGeojson.objects.filter(
                    indicatorData=indicator_data
                ).first()
                if geojson and geojson.geojson:
                    # Use the existing geojson but augment with additional deck.gl data
                    try:
                        # Handle both string and dict cases
                        if isinstance(geojson.geojson, str):
                            base_data = json.loads(geojson.geojson)
                        elif isinstance(geojson.geojson, dict):
                            base_data = geojson.geojson
                        else:
                            raise ValueError(
                                f"Unexpected geojson type: {type(geojson.geojson)}"
                            )

                        # Ensure data is JSON serializable by converting to string first
                        result.update(base_data)
                    except Exception as e:
                        print(f"Error processing GeoJSON: {e}")
                        # Don't use the existing geojson if it can't be processed
            except Exception as e:
                print(f"Error loading GeoJSON: {e}")
                # Continue with synthetic data

            # Generate appropriate data based on indicator type
            if indicator_type == "mobility":
                # Generate mobility data if not already in result
                if "trips" not in result:
                    # Create synthetic trip data
                    center_lon, center_lat = -74.006, 40.7128
                    trips = []

                    # Generate synthetic trip paths
                    for i in range(100):
                        # Random start and end points around the center
                        start_lon = center_lon + (random.random() - 0.5) * 0.1
                        start_lat = center_lat + (random.random() - 0.5) * 0.1
                        end_lon = center_lon + (random.random() - 0.5) * 0.1
                        end_lat = center_lat + (random.random() - 0.5) * 0.1

                        # Generate some waypoints
                        num_waypoints = random.randint(1, 3)
                        path = [[start_lon, start_lat]]

                        for j in range(num_waypoints):
                            way_lon = start_lon + (end_lon - start_lon) * (j + 1) / (
                                num_waypoints + 1
                            )
                            way_lat = start_lat + (end_lat - start_lat) * (j + 1) / (
                                num_waypoints + 1
                            )
                            # Add some randomness to waypoints
                            way_lon += (random.random() - 0.5) * 0.01
                            way_lat += (random.random() - 0.5) * 0.01
                            path.append([way_lon, way_lat])

                        path.append([end_lon, end_lat])

                        # Generate timestamps for animation
                        timestamps = [i * 20 for i in range(len(path))]

                        trips.append(
                            {
                                "path": path,
                                "timestamps": timestamps,
                                "mode": random.choice(
                                    ["walk", "bike", "car", "transit"]
                                ),
                                "duration": timestamps[-1],
                            }
                        )

                    result["trips"] = trips

                # Add transit network if not present
                if "transit" not in result:
                    # Simplified transit network
                    result["transit"] = {"type": "FeatureCollection", "features": []}

                    # Generate some transit lines
                    for i in range(10):
                        # Main axis
                        start_lon = bounds["west"] + random.random() * (
                            bounds["east"] - bounds["west"]
                        )
                        start_lat = bounds["south"] + random.random() * (
                            bounds["north"] - bounds["south"]
                        )
                        end_lon = bounds["west"] + random.random() * (
                            bounds["east"] - bounds["west"]
                        )
                        end_lat = bounds["south"] + random.random() * (
                            bounds["north"] - bounds["south"]
                        )

                        # Pre-compute the color array to avoid serialization issues
                        color_array = random.choice(
                            [
                                [255, 0, 0],  # Red
                                [0, 255, 0],  # Green
                                [0, 0, 255],  # Blue
                                [255, 255, 0],  # Yellow
                                [0, 255, 255],  # Cyan
                                [255, 0, 255],  # Magenta
                            ]
                        )

                        # Create line feature
                        line_feature = {
                            "type": "Feature",
                            "geometry": {
                                "type": "LineString",
                                "coordinates": [
                                    [start_lon, start_lat],
                                    [end_lon, end_lat],
                                ],
                            },
                            "properties": {
                                "id": f"line_{i}",
                                "name": f"Transit Line {i+1}",
                                "type": random.choice(["subway", "bus", "rail"]),
                                "color": color_array,
                            },
                        }
                        result["transit"]["features"].append(line_feature)

            elif indicator_type == "climate":
                # Generate climate data if not already in result
                if "points" not in result:
                    # Create synthetic heat map data
                    points = []

                    # Generate heat map points with varying intensity
                    for i in range(1000):
                        lon = bounds["west"] + random.random() * (
                            bounds["east"] - bounds["west"]
                        )
                        lat = bounds["south"] + random.random() * (
                            bounds["north"] - bounds["south"]
                        )

                        # Make intensity higher in center and lower at edges
                        dx = (lon - (bounds["west"] + bounds["east"]) / 2) / (
                            (bounds["east"] - bounds["west"]) / 2
                        )
                        dy = (lat - (bounds["south"] + bounds["north"]) / 2) / (
                            (bounds["north"] - bounds["south"]) / 2
                        )
                        dist = np.sqrt(dx * dx + dy * dy)
                        intensity = float(max(0, 10 * (1 - dist) + random.random() * 3))

                        points.append(
                            {
                                "coordinates": [lon, lat],
                                "properties": {
                                    "intensity": intensity,
                                    "category": random.choice(
                                        ["temperature", "pollution", "co2"]
                                    ),
                                },
                            }
                        )

                    result["points"] = points

                # Add boundary data if not present
                if "boundaries" not in result:
                    # Create boundary polygons for climate zones
                    result["boundaries"] = {"type": "FeatureCollection", "features": []}

                    # Create a few climate zone boundaries
                    for i in range(5):
                        # Create a random polygon within bounds
                        west = bounds["west"] + random.random() * 0.7 * (
                            bounds["east"] - bounds["west"]
                        )
                        south = bounds["south"] + random.random() * 0.7 * (
                            bounds["north"] - bounds["south"]
                        )
                        width = (
                            random.random() * 0.3 * (bounds["east"] - bounds["west"])
                        )
                        height = (
                            random.random() * 0.3 * (bounds["north"] - bounds["south"])
                        )

                        # Pre-compute color array
                        color_value = random.random() * 100
                        if color_value < 33:
                            colorArray = [50, 100, 200, 100]  # Blue for low values
                        elif color_value < 66:
                            colorArray = [100, 200, 100, 100]  # Green for medium values
                        else:
                            colorArray = [200, 100, 50, 100]  # Red for high values

                        polygon_feature = {
                            "type": "Feature",
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [
                                    [
                                        [west, south],
                                        [west + width, south],
                                        [west + width, south + height],
                                        [west, south + height],
                                        [west, south],
                                    ]
                                ],
                            },
                            "properties": {
                                "id": f"zone_{i}",
                                "name": f"Climate Zone {i+1}",
                                "category": random.choice(
                                    ["urban", "suburban", "park", "industrial"]
                                ),
                                "value": float(random.random() * 100),
                                "colorArray": colorArray,
                            },
                        }
                        result["boundaries"]["features"].append(polygon_feature)

            elif indicator_type == "land_use":
                # Generate land use data if not already in result
                if "points" not in result:
                    # Create synthetic point data for hexagon layer
                    points = []

                    # Generate dense points for hexagon aggregation
                    for i in range(2000):
                        lon = bounds["west"] + random.random() * (
                            bounds["east"] - bounds["west"]
                        )
                        lat = bounds["south"] + random.random() * (
                            bounds["north"] - bounds["south"]
                        )

                        # Random height and color values
                        height = float(random.random() * 200)  # Building height
                        color_value = float(random.random() * 10)  # For color gradients

                        points.append(
                            {
                                "coordinates": [lon, lat],
                                "properties": {
                                    "height": height,
                                    "color_value": color_value,
                                    "type": random.choice(
                                        [
                                            "residential",
                                            "commercial",
                                            "industrial",
                                            "mixed",
                                        ]
                                    ),
                                },
                            }
                        )

                    result["points"] = points

                # Add building data if not present
                if "buildings" not in result:
                    # Create 3D building data
                    result["buildings"] = {"type": "FeatureCollection", "features": []}

                    # Generate building polygons
                    building_count = 100  # Reduced from 200 to improve performance
                    for i in range(building_count):
                        # Create a random polygon for a building
                        center_lon = bounds["west"] + random.random() * (
                            bounds["east"] - bounds["west"]
                        )
                        center_lat = bounds["south"] + random.random() * (
                            bounds["north"] - bounds["south"]
                        )

                        # Random building size
                        size = random.random() * 0.005 + 0.001

                        # Create polygon with slight irregularity
                        vertices = []
                        vertex_count = random.randint(4, 6)
                        for j in range(vertex_count):
                            angle = j * 2 * np.pi / vertex_count
                            dist = size * (0.8 + 0.4 * random.random())
                            lon = center_lon + dist * np.cos(angle)
                            lat = center_lat + dist * np.sin(angle)
                            vertices.append([lon, lat])

                        # Close the polygon
                        vertices.append(vertices[0])

                        # Assign building height and type
                        height = float(
                            random.random() * 100 + 10
                        )  # Range from 10 to 110

                        # Assign different colors based on building type
                        building_type = random.choice(
                            ["residential", "commercial", "industrial", "mixed"]
                        )
                        if building_type == "residential":
                            color = [66, 135, 245, 200]  # Blue
                        elif building_type == "commercial":
                            color = [240, 149, 12, 200]  # Orange
                        elif building_type == "industrial":
                            color = [120, 120, 120, 200]  # Gray
                        else:  # mixed
                            color = [20, 160, 90, 200]  # Green

                        building_feature = {
                            "type": "Feature",
                            "geometry": {"type": "Polygon", "coordinates": [vertices]},
                            "properties": {
                                "id": f"building_{i}",
                                "height": height,
                                "color": color,
                                "type": building_type,
                            },
                        }
                        result["buildings"]["features"].append(building_feature)

            else:
                # Default visualization with points of interest
                if "features" not in result:
                    result["features"] = []

                    # Generate random points
                    for i in range(100):
                        lon = bounds["west"] + random.random() * (
                            bounds["east"] - bounds["west"]
                        )
                        lat = bounds["south"] + random.random() * (
                            bounds["north"] - bounds["south"]
                        )

                        # Pre-compute color array
                        color = [
                            int(random.random() * 255),
                            int(random.random() * 255),
                            int(random.random() * 255),
                        ]

                        result["features"].append(
                            {
                                "geometry": {
                                    "type": "Point",
                                    "coordinates": [lon, lat],
                                },
                                "properties": {
                                    "id": f"poi_{i}",
                                    "name": f"Point {i+1}",
                                    "radius": float(random.random() * 100 + 20),
                                    "color": color,
                                },
                            }
                        )

            # Verify the entire result is serializable
            try:
                # Convert non-serializable types to strings
                json_str = json.dumps(
                    result,
                    default=lambda obj: (
                        str(obj)
                        if not isinstance(
                            obj, (dict, list, str, int, float, bool, type(None))
                        )
                        else obj
                    ),
                )
                # Parse back to ensure valid
                test_result = json.loads(json_str)
                # Return the validated result
                return test_result
            except Exception as e:
                print(f"Error serializing result: {e}")
                # Return a simplified version without the problematic parts
                return {
                    "error": f"Data serialization error: {e}",
                    "metadata": result.get("metadata", {}),
                }

            return result

        except Exception as e:
            print(f"Error processing data for deck.gl: {e}")
            import traceback

            traceback.print_exc()

            # Return a minimal result with error info
            return {
                "error": str(e),
                "metadata": {
                    "timestamp": datetime.now().isoformat(),
                    "indicator_type": indicator_type,
                    "year": year,
                },
            }

    @action(detail=False, methods=["get"])
    def get_current_dashboard_data(self, request):
        """
        Get dashboard data for the current or specified state.
        This endpoint is used to fetch data for all charts in the dashboard.
        """
        # Check if we have a year parameter - if so, find the matching state
        year_param = request.query_params.get("year")
        if year_param and year_param.isdigit():
            year = int(year_param)
            # Find a state with this year
            matched_state = None
            states = State.objects.all()
            for s in states:
                if s.state_values.get("year") == year:
                    matched_state = s
                    break

            # If we found a state with the requested year, use that instead of the global state
            if matched_state:
                dashboard_data = DashboardFeedState.objects.filter(
                    state=matched_state
                ).first()

                if dashboard_data:
                    response = JsonResponse(
                        {
                            "data": dashboard_data.data,
                            "state": matched_state.state_values,
                        }
                    )
                    self._add_no_cache_headers(response)
                    return response

        # If no year param or no match found, use the current global state
        state = State.objects.filter(state_values=globals.INDICATOR_STATE)
        dashboard_data = DashboardFeedState.objects.filter(state=state.first()).first()

        if not dashboard_data:
            return JsonResponse(
                {
                    "error": "No dashboard data found for the current state",
                    "state": globals.INDICATOR_STATE,
                },
                status=404,
            )

        response = JsonResponse(
            {"data": dashboard_data.data, "state": state.first().state_values}
        )
        self._add_no_cache_headers(response)
        return response


# Custom view to serve map files directly
from django.http import FileResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt
import os
from django.conf import settings
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.views import APIView
from pathlib import Path


@csrf_exempt
def serve_map_file(request, path):
    file_path = os.path.join(settings.MEDIA_ROOT, "maps", path)
    if os.path.exists(file_path):
        return FileResponse(open(file_path, "rb"), content_type="text/html")
    return HttpResponse("File not found", status=404)


class ImageUploadView(APIView):
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request, *args, **kwargs):
        try:
            # Validate request data
            indicator_id = request.data.get("indicator_id")
            state_id = request.data.get("state_id")
            image_file = request.FILES.get("image")

            if not all([indicator_id, state_id, image_file]):
                return Response(
                    {
                        "error": "Missing required field",
                        "required_fields": ["indicator_id", "state_id", "image"],
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Find or create the indicator data entry
            try:
                indicator = Indicator.objects.get(indicator_id=indicator_id)
                state = State.objects.get(id=state_id)

                indicator_data, created = IndicatorData.objects.get_or_create(
                    indicator=indicator, state=state
                )

                # Create image with proper file validation
                image_extension = Path(image_file.name).suffix.lower()
                allowed_extensions = [".jpg", ".jpeg", ".png", ".gif", ".svg"]

                if image_extension not in allowed_extensions:
                    return Response(
                        {
                            "error": "Invalid file type",
                            "allowed_types": allowed_extensions,
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                # Create a unique filename
                indicator_name = indicator.name.replace(" ", "_").lower()
                state_year = state.state_values.get("year", 2023)
                category = indicator.category

                # Generate path based on indicator category
                folder_path = f"indicators/{category}"
                os.makedirs(
                    os.path.join(settings.MEDIA_ROOT, folder_path), exist_ok=True
                )

                # Create a filename based on indicator and state
                filename = f"{indicator_name}_{state_year}{image_extension}"
                file_path = f"{folder_path}/{filename}"

                # Save the image in the database and file system
                image = IndicatorImage.objects.create(
                    indicatorData=indicator_data, image=file_path
                )

                # Save the file to disk
                with open(
                    os.path.join(settings.MEDIA_ROOT, file_path), "wb+"
                ) as destination:
                    for chunk in image_file.chunks():
                        destination.write(chunk)

                # Assert correct file permissions
                os.chmod(os.path.join(settings.MEDIA_ROOT, file_path), 0o644)

                return Response(
                    {
                        "status": "success",
                        "message": "Image uploaded successfully",
                        "image_url": f"/media/{file_path}",
                        "image_id": image.id,
                    },
                    status=status.HTTP_201_CREATED,
                )

            except Indicator.DoesNotExist:
                return Response(
                    {"error": "Indicator not found"}, status=status.HTTP_404_NOT_FOUND
                )
            except State.DoesNotExist:
                return Response(
                    {"error": "State not found"}, status=status.HTTP_404_NOT_FOUND
                )

        except Exception as e:
            return Response(
                {"error": f"Failed to upload image: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
