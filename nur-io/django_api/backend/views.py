from django.shortcuts import render
from django.db import models
from django.http import JsonResponse
from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
import json
import os
from django.conf import settings
from datetime import datetime

from .models import (
    Table,
    Indicator,
    IndicatorData,
    IndicatorImage,
    State,
    DashboardFeedState,
    LayerConfig,
    UserUpload,
    UserUploadCategory,
)

from .serializers import (
    TableSerializer,
    IndicatorSerializer,
    IndicatorDataSerializer,
    IndicatorImageSerializer,
    StateSerializer,
    DashboardFeedStateSerializer,
    LayerConfigSerializer,
    UserUploadSerializer,
    UserUploadCategorySerializer,
)


class TableViewSet(viewsets.ModelViewSet):
    serializer_class = TableSerializer
    queryset = Table.objects.all()

    def get_queryset(self):
        queryset = Table.objects.all()
        is_active = self.request.query_params.get("is_active", None)
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == "true")
        return queryset


class IndicatorViewSet(viewsets.ModelViewSet):
    serializer_class = IndicatorSerializer

    def get_queryset(self):
        queryset = Indicator.objects.all()
        table_name = self.request.query_params.get("table", None)
        if table_name:
            queryset = queryset.filter(table__name=table_name)
        return queryset


class StateViewSet(viewsets.ModelViewSet):
    queryset = State.objects.all()
    serializer_class = StateSerializer


class IndicatorDataViewSet(viewsets.ModelViewSet):
    queryset = IndicatorData.objects.all()
    serializer_class = IndicatorDataSerializer


class IndicatorImageViewSet(viewsets.ModelViewSet):
    queryset = IndicatorImage.objects.all()
    serializer_class = IndicatorImageSerializer


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


class UserUploadCategoryViewSet(viewsets.ModelViewSet):
    queryset = UserUploadCategory.objects.all()
    serializer_class = UserUploadCategorySerializer

    def create(self, request, *args, **kwargs):
        name = request.data.get("name", "").strip().lower().replace(" ", "_")
        display_name = request.data.get("display_name", "").strip()

        if not name or not display_name:
            return Response(
                {"error": "Name and display_name are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if name already exists
        if UserUploadCategory.objects.filter(name=name).exists():
            return Response(
                {"error": "Category with this name already exists"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            category = UserUploadCategory.objects.create(
                name=name,
                display_name=display_name,
            )
            serializer = self.get_serializer(category)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response(
                {"error": f"Failed to create category: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class UserUploadViewSet(viewsets.ModelViewSet):
    queryset = UserUpload.objects.all()
    serializer_class = UserUploadSerializer
    parser_classes = (MultiPartParser, FormParser, JSONParser)

    def get_queryset(self):
        queryset = UserUpload.objects.all()
        category_id = self.request.query_params.get("category", None)
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        return queryset

    def create(self, request, *args, **kwargs):
        image_file = request.FILES.get("image")
        display_name = request.data.get("display_name", "")
        category_id = request.data.get("category_id")

        if not image_file:
            return Response(
                {"error": "No image file provided"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate file type
        image_extension = Path(image_file.name).suffix.lower()
        allowed_extensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"]

        if image_extension not in allowed_extensions:
            return Response(
                {
                    "error": "Invalid file type",
                    "allowed_types": allowed_extensions,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate file size (max 10MB)
        if image_file.size > 10 * 1024 * 1024:
            return Response(
                {"error": "File size exceeds 10MB limit"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            category = None
            if category_id:
                try:
                    category = UserUploadCategory.objects.get(id=category_id)
                except UserUploadCategory.DoesNotExist:
                    pass

            # If no category specified, use default
            if not category:
                category = UserUploadCategory.objects.filter(is_default=True).first()
                if not category:
                    # Create default category if it doesn't exist
                    category, _ = UserUploadCategory.objects.get_or_create(
                        name="user_uploads",
                        defaults={"display_name": "User Uploads", "is_default": True}
                    )

            # Create user upload entry
            user_upload = UserUpload.objects.create(
                image=image_file,
                display_name=display_name or image_file.name,
                original_filename=image_file.name,
                file_size=image_file.size,
                category=category,
            )

            serializer = self.get_serializer(user_upload)
            return Response(serializer.data, status=status.HTTP_201_CREATED)

        except Exception as e:
            return Response(
                {"error": f"Failed to upload image: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


# Now lets program the views for the API as an interactive platform

from . import globals
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

def broadcast_presentation_update():
    """Broadcast presentation state to all connected WebSocket clients"""
    channel_layer = get_channel_layer()
    if channel_layer:
        try:
            async_to_sync(channel_layer.group_send)(
                'presentation_channel',
                {
                    'type': 'presentation_update',
                    'data': {
                        'is_playing': globals.PRESENTATION_PLAYING,
                        'sequence': globals.PRESENTATION_SEQUENCE,
                        'sequence_index': globals.PRESENTATION_SEQUENCE_INDEX,
                        'duration': globals.PRESENTATION_DURATION,
                    }
                }
            )
        except Exception as e:
            print(f"WebSocket broadcast error: {e}")

def broadcast_indicator_update():
    """Broadcast indicator state to all connected WebSocket clients"""
    channel_layer = get_channel_layer()
    if channel_layer:
        try:
            async_to_sync(channel_layer.group_send)(
                'presentation_channel',
                {
                    'type': 'indicator_update',
                    'data': {
                        'indicator_id': globals.INDICATOR_ID,
                        'indicator_state': globals.INDICATOR_STATE,
                        'visualization_mode': globals.VISUALIZATION_MODE,
                        'active_user_upload': globals.ACTIVE_USER_UPLOAD,
                    }
                }
            )
        except Exception as e:
            print(f"WebSocket broadcast error: {e}")


class CustomActionsViewSet(viewsets.ViewSet):
    """
    ViewSet for custom actions, including state management for indicators
    and dashboard data retrieval.
    """

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Initialize the state if it's empty
        self._initialize_default_state()

    @action(detail=False, methods=["post"])
    def log_frontend_error(self, request):
        """
        Bridge endpoint to log frontend errors to backend console.
        This helps debug frontend issues by seeing them in Django logs.
        """
        try:
            error_data = request.data
            error_type = error_data.get("type", "Error")
            error_message = error_data.get("message", "No message provided")
            error_stack = error_data.get("stack", "")
            error_url = error_data.get("url", "")
            error_timestamp = error_data.get("timestamp", "")
            error_component = error_data.get("component", "Unknown")
            error_user_agent = request.META.get("HTTP_USER_AGENT", "Unknown")
            error_ip = request.META.get("REMOTE_ADDR", "Unknown")

            # Format error for console output
            print("\n" + "=" * 80)
            print(f"🔴 FRONTEND ERROR LOGGED")
            print("=" * 80)
            print(f"Type: {error_type}")
            print(f"Component: {error_component}")
            print(f"Message: {error_message}")
            if error_url:
                print(f"URL: {error_url}")
            if error_timestamp:
                print(f"Timestamp: {error_timestamp}")
            print(f"User Agent: {error_user_agent}")
            print(f"IP: {error_ip}")
            if error_stack:
                print(f"\nStack Trace:")
                print(error_stack)
            if error_data.get("additional_data"):
                print(f"\nAdditional Data:")
                import json
                print(json.dumps(error_data.get("additional_data"), indent=2))
            print("=" * 80 + "\n")

            return JsonResponse({"status": "logged"}, status=200)
        except Exception as e:
            print(f"❌ Error logging frontend error: {e}")
            return JsonResponse({"status": "error", "message": str(e)}, status=500)

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
                    # Use the default state values directly
                    globals.INDICATOR_STATE = globals.DEFAULT_STATES
                    print(
                        f"No states in database. Using default: {globals.INDICATOR_STATE}"
                    )
            except Exception as e:
                print(f"Error initializing default state: {e}")
                # Use minimal default state
                globals.INDICATOR_STATE = {"year": 2023}

    @action(detail=False, methods=["get"])
    def get_global_variables(self, request):
        """Get current global variables (indicator, state, visualization mode, presentation state)"""
        response = JsonResponse(
            {
                "indicator_id": globals.INDICATOR_ID,
                "indicator_state": globals.INDICATOR_STATE,
                "visualization_mode": globals.VISUALIZATION_MODE,
                "presentation_playing": globals.PRESENTATION_PLAYING,
                "active_user_upload": globals.ACTIVE_USER_UPLOAD,
            }
        )
        self._add_no_cache_headers(response)
        return response

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
        broadcast_indicator_update()
        print(f"✓ Visualization mode set to: {mode}")

        return JsonResponse({"status": "ok", "visualization_mode": mode})

    @action(detail=False, methods=["get"])
    def get_presentation_state(self, request):
        """Get current presentation state (playing, sequence, index, duration)"""
        response = JsonResponse({
            "is_playing": globals.PRESENTATION_PLAYING,
            "sequence": globals.PRESENTATION_SEQUENCE,
            "sequence_index": globals.PRESENTATION_SEQUENCE_INDEX,
            "duration": globals.PRESENTATION_DURATION,
        })
        self._add_no_cache_headers(response)
        return response

    @action(detail=False, methods=["post"])
    def set_presentation_state(self, request):
        """Set presentation state (play/pause, sequence, index, duration)"""
        # Update playing state if provided
        if "is_playing" in request.data:
            globals.PRESENTATION_PLAYING = bool(request.data.get("is_playing"))
            print(f"✓ Presentation playing: {globals.PRESENTATION_PLAYING}")
        
        # Update sequence if provided
        if "sequence" in request.data:
            sequence = request.data.get("sequence")
            if isinstance(sequence, list):
                globals.PRESENTATION_SEQUENCE = sequence
                print(f"✓ Presentation sequence updated: {len(sequence)} slides")
        
        # Update sequence index if provided
        if "sequence_index" in request.data:
            index = request.data.get("sequence_index")
            if isinstance(index, int):
                # Clamp index to valid range instead of silently ignoring out-of-bounds values
                sequence_length = len(globals.PRESENTATION_SEQUENCE)
                if sequence_length > 0:
                    clamped_index = max(0, min(index, sequence_length - 1))
                    if clamped_index != index:
                        print(f"⚠️ Presentation index {index} out of bounds, clamped to {clamped_index}")
                    globals.PRESENTATION_SEQUENCE_INDEX = clamped_index
                    print(f"✓ Presentation index: {clamped_index}")
                else:
                    globals.PRESENTATION_SEQUENCE_INDEX = 0
                    print(f"⚠️ Empty sequence, index reset to 0")
        
        # Update duration if provided
        if "duration" in request.data:
            duration = request.data.get("duration")
            if isinstance(duration, (int, float)) and duration >= 1:
                globals.PRESENTATION_DURATION = int(duration)
                print(f"✓ Presentation duration: {duration}s")
        
        # Broadcast to all connected clients via WebSocket
        broadcast_presentation_update()
        
        return JsonResponse({
            "status": "ok",
            "is_playing": globals.PRESENTATION_PLAYING,
            "sequence": globals.PRESENTATION_SEQUENCE,
            "sequence_index": globals.PRESENTATION_SEQUENCE_INDEX,
            "duration": globals.PRESENTATION_DURATION,
        })

    @action(detail=False, methods=["post"])
    def set_active_user_upload(self, request):
        """Set or clear the active user upload for display"""
        upload_id = request.data.get("upload_id")
        
        if upload_id is None:
            # Clear active user upload
            globals.ACTIVE_USER_UPLOAD = None
            print("✓ Cleared active user upload")
            broadcast_indicator_update()
            return JsonResponse({"status": "ok", "active_user_upload": None})
        
        try:
            # Fetch the user upload
            user_upload = UserUpload.objects.get(id=upload_id)
            
            # Set the active user upload
            globals.ACTIVE_USER_UPLOAD = {
                "id": user_upload.id,
                "image_url": user_upload.image.url if user_upload.image else None,
                "display_name": user_upload.display_name or user_upload.original_filename,
                "category_id": user_upload.category_id,
            }
            print(f"✓ Set active user upload: {globals.ACTIVE_USER_UPLOAD['display_name']}")
            broadcast_indicator_update()
            
            return JsonResponse({
                "status": "ok", 
                "active_user_upload": globals.ACTIVE_USER_UPLOAD
            })
        except UserUpload.DoesNotExist:
            return JsonResponse(
                {"status": "error", "message": "User upload not found"},
                status=404
            )
        except Exception as e:
            print(f"❌ Error setting active user upload: {e}")
            return JsonResponse(
                {"status": "error", "message": str(e)},
                status=500
            )

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
            print(f"✓ Indicator set to ID: {indicator_id}")
            
            # Update INDICATOR_STATE to match the new indicator's default state
            idistrict_table = Table.objects.filter(name="idistrict").first()
            if idistrict_table:
                indicator = Indicator.objects.filter(table=idistrict_table, indicator_id=indicator_id).first()
            else:
                indicator = Indicator.objects.filter(indicator_id=indicator_id).first()
            if indicator and indicator.category == "climate":
                # Set default climate state
                globals.INDICATOR_STATE = globals.DEFAULT_CLIMATE_STATE.copy()
                print(f"✓ Set default climate state: {globals.INDICATOR_STATE}")
            else:
                # Set default mobility/other state
                globals.INDICATOR_STATE = globals.DEFAULT_STATES.copy()
                print(f"✓ Set default mobility state: {globals.INDICATOR_STATE}")
            
            broadcast_indicator_update()
            return True
        except Exception as e:
            print(f"❌ Error setting indicator: {e}")
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

    @action(detail=False, methods=["post"])
    def set_climate_scenario(self, request):
        """Set climate scenario by scenario name and type (utci/plan)"""
        scenario_name = request.data.get("scenario")
        scenario_type = request.data.get("type", "utci")

        if not scenario_name:
            return JsonResponse(
                {"status": "error", "message": "Scenario name is required"}, status=400
            )

        if scenario_type not in ["utci", "plan"]:
            return JsonResponse(
                {"status": "error", "message": "Type must be 'utci' or 'plan'"},
                status=400,
            )

        try:
            # Find the state by scenario name and type
            state = State.objects.filter(
                scenario_name=scenario_name, scenario_type=scenario_type
            ).first()

            if not state:
                return JsonResponse(
                    {
                        "status": "error",
                        "message": f"Climate scenario '{scenario_name}' with type '{scenario_type}' not found",
                    },
                    status=404,
                )

            # Update global state
            new_state = {
                "scenario": scenario_name,
                "type": scenario_type,
                "label": state.state_values.get(
                    "label", f"{scenario_name} - {scenario_type}"
                ),
            }

            if self._set_current_state(new_state):
                print(
                    f"✓ Climate scenario set successfully: {scenario_name} ({scenario_type})"
                )
                print(f"✓ globals.INDICATOR_STATE is now: {globals.INDICATOR_STATE}")
                return JsonResponse(
                    {
                        "status": "ok",
                        "scenario": scenario_name,
                        "type": scenario_type,
                        "state": new_state,
                    }
                )
            else:
                return JsonResponse(
                    {"status": "error", "message": "Failed to set climate scenario"}
                )
        except Exception as e:
            print(f"Error setting climate scenario: {e}")
            return JsonResponse({"status": "error", "message": str(e)}, status=500)

    def _set_current_state(self, state):
        """Set the current indicator state globally"""
        try:
            globals.INDICATOR_STATE = state
            print(f"✓ State updated to: {state}")
            broadcast_indicator_update()
            return True
        except Exception as e:
            print(f"❌ Error setting state: {e}")
            return False

    @action(detail=False, methods=["get"])
    def get_image_data(self, request):
        # Priority: If there's an active user upload in global state, return it
        # This ensures the projection module displays user uploads during presentation mode
        if globals.ACTIVE_USER_UPLOAD and globals.ACTIVE_USER_UPLOAD.get("image_url"):
            image_url = globals.ACTIVE_USER_UPLOAD["image_url"]
            # Strip /media/ prefix if present since we add it in response handling
            if image_url.startswith("/media/"):
                image_url = image_url[7:]
            response = JsonResponse({
                "image_data": image_url,
                "type": "image",
                "is_user_upload": True,
                "display_name": globals.ACTIVE_USER_UPLOAD.get("display_name"),
            })
            self._add_no_cache_headers(response)
            return response
        
        # Check for user upload indicator first
        indicator_param = request.query_params.get("indicator")
        user_upload_id = request.query_params.get("user_upload_id")
        
        # Handle user upload images
        if indicator_param and indicator_param.startswith("user_upload") or user_upload_id:
            try:
                if user_upload_id:
                    # Direct user upload ID provided
                    user_upload = UserUpload.objects.get(id=user_upload_id)
                else:
                    # Extract category name from indicator (format: user_upload_<category_name>)
                    category_name = indicator_param.replace("user_upload_", "") if indicator_param else None
                    if category_name:
                        # Get first upload from this category
                        category = UserUploadCategory.objects.filter(name=category_name).first()
                        if category:
                            user_upload = UserUpload.objects.filter(category=category).first()
                        else:
                            user_upload = None
                    else:
                        # Fallback: get any user upload
                        user_upload = UserUpload.objects.first()
                
                if user_upload and user_upload.image:
                    image_path = user_upload.image.name
                    response = JsonResponse(
                        {"image_data": image_path, "type": "image", "is_user_upload": True}
                    )
                    self._add_no_cache_headers(response)
                    return response
                else:
                    response = JsonResponse(
                        {"error": "User upload not found"}, status=404
                    )
                    self._add_no_cache_headers(response)
                    return response
            except UserUpload.DoesNotExist:
                response = JsonResponse(
                    {"error": "User upload not found"}, status=404
                )
                self._add_no_cache_headers(response)
                return response
            except Exception as e:
                response = JsonResponse(
                    {"error": f"Error fetching user upload: {str(e)}"}, status=500
                )
                self._add_no_cache_headers(response)
                return response
        
        # Ensure we have a default state
        self._initialize_default_state()

        # Check if query parameters were provided for PREFETCH mode
        # This allows fetching specific images without modifying globals
        scenario_param = request.query_params.get("scenario")  # For prefetching specific states
        type_param = request.query_params.get("type")  # For climate type (utci/plan)
        prefetch_mode = scenario_param is not None  # If scenario is specified, don't use globals

        # Indicator name to ID mapping
        indicator_mapping = {"mobility": 1, "climate": 2, "land_use": 3}
        
        # Initialize effective_indicator_id (will be set based on mode)
        effective_indicator_id = None

        # Check if presentation mode is active and should override normal behavior
        # Only use presentation mode if NOT in prefetch mode (prefetch has explicit params)
        use_presentation_mode = (
            not prefetch_mode
            and globals.PRESENTATION_PLAYING
            and globals.PRESENTATION_SEQUENCE
            and len(globals.PRESENTATION_SEQUENCE) > 0
        )

        if use_presentation_mode:
            # Get current slide from presentation sequence
            current_index = max(
                0, min(globals.PRESENTATION_SEQUENCE_INDEX, len(globals.PRESENTATION_SEQUENCE) - 1)
            )
            current_slide = globals.PRESENTATION_SEQUENCE[current_index]

            if current_slide and current_slide.get("indicator") and current_slide.get("state"):
                # Extract indicator and state from current slide
                slide_indicator = current_slide.get("indicator")
                slide_state = current_slide.get("state")
                slide_type = current_slide.get("type")  # For climate slides

                # Map indicator name to ID
                effective_indicator_id = indicator_mapping.get(slide_indicator)
                
                if effective_indicator_id:
                    print(f"🎬 Presentation mode active - using slide {current_index + 1}/{len(globals.PRESENTATION_SEQUENCE)}")
                    print(f"   Indicator: {slide_indicator}, State: {slide_state}" + (f", Type: {slide_type}" if slide_type else ""))
                    
                    # Override indicator_param and scenario_param to use presentation slide data
                    # This ensures the rest of the function uses the presentation slide values
                    indicator_param = slide_indicator
                    if slide_indicator == "climate" and slide_type:
                        # For climate, we need to map state name to scenario key
                        # The state name in the slide is the display name (e.g., "Existing")
                        # We need to find the corresponding scenario key (e.g., "existing")
                        from backend.climate_scenarios import CLIMATE_SCENARIO_MAPPING
                        scenario_key = None
                        for key, config in CLIMATE_SCENARIO_MAPPING.items():
                            if config["display_name"] == slide_state:
                                scenario_key = key
                                break
                        
                        if scenario_key:
                            scenario_param = scenario_key
                            type_param = slide_type or "utci"
                        else:
                            # Fallback: try lowercase state name
                            scenario_param = slide_state.lower().replace(" ", "_")
                            type_param = slide_type or "utci"
                    else:
                        # For mobility and other indicators, use state name as scenario
                        scenario_param = slide_state.lower()
                    
                    # Set prefetch_mode to True so we use the params instead of globals
                    prefetch_mode = True
                else:
                    print(f"⚠️ Invalid indicator in presentation slide: {slide_indicator}")
                    use_presentation_mode = False
                    effective_indicator_id = None  # Reset since presentation mode failed
            else:
                print(f"⚠️ Invalid presentation slide at index {current_index}")
                use_presentation_mode = False
                effective_indicator_id = None  # Reset since presentation mode failed

        # Determine which indicator to use (if not already set by presentation mode)
        if not use_presentation_mode or effective_indicator_id is None:
            if indicator_param:
                indicator_id = indicator_mapping.get(indicator_param)
                if indicator_id and not prefetch_mode:
                    # Only modify globals if NOT in prefetch mode
                    globals.INDICATOR_ID = indicator_id
            else:
                indicator_id = globals.INDICATOR_ID

            # Use the indicator_id we determined (either from param or globals)
            effective_indicator_id = indicator_mapping.get(indicator_param) if indicator_param else globals.INDICATOR_ID
        # else: effective_indicator_id was already set above from presentation slide

        # Debug (reduced logging in prefetch mode, but show presentation mode info)
        if not prefetch_mode or use_presentation_mode:
            if use_presentation_mode:
                print(f"Current indicator_id (from presentation): {effective_indicator_id}")
            else:
                print(f"Current indicator_id: {globals.INDICATOR_ID}")
                print(f"Current state: {globals.INDICATOR_STATE}")
                print(f"Visualization mode: {globals.VISUALIZATION_MODE}")

        # Query indicator - default to idistrict table for backward compatibility
        idistrict_table = Table.objects.filter(name="idistrict").first()
        if idistrict_table:
            indicator = Indicator.objects.filter(table=idistrict_table, indicator_id=effective_indicator_id)
        else:
            indicator = Indicator.objects.filter(indicator_id=effective_indicator_id)
        
        if not indicator.exists() or not indicator.first():
            # Fallback: try any indicator with this ID
            indicator = Indicator.objects.filter(indicator_id=effective_indicator_id)
            if not indicator.exists():
                indicator = Indicator.objects.first()
                if indicator:
                    if not prefetch_mode:
                        globals.INDICATOR_ID = indicator.indicator_id
                else:
                    response = JsonResponse({"error": "No indicators found"}, status=404)
                    self._add_no_cache_headers(response)
                    return response

        indicator_obj = indicator.first()

        # Special handling for climate scenarios
        if indicator_obj.category == "climate":
            # Use query params if in prefetch mode, otherwise use globals
            if prefetch_mode and scenario_param:
                scenario_name = scenario_param
                scenario_type = type_param or "utci"
                print(f"🌡️ PREFETCH mode - climate scenario: {scenario_name}, type: {scenario_type}")
            else:
                scenario_name = globals.INDICATOR_STATE.get("scenario")
                scenario_type = globals.INDICATOR_STATE.get("type", "utci")
                print(f"🌡️ get_image_data for climate - scenario: {scenario_name}, type: {scenario_type}")

            if scenario_name:
                state = State.objects.filter(
                    scenario_name=scenario_name, scenario_type=scenario_type
                ).first()

                if state:
                    print(f"✓ Found climate scenario state: {state.scenario_name} ({state.scenario_type})")
                else:
                    from backend.climate_scenarios import (
                        DEFAULT_CLIMATE_SCENARIO,
                        DEFAULT_CLIMATE_TYPE,
                    )
                    state = State.objects.filter(
                        scenario_name=DEFAULT_CLIMATE_SCENARIO,
                        scenario_type=DEFAULT_CLIMATE_TYPE,
                    ).first()
                    print(f"Using default climate scenario")
            else:
                from backend.climate_scenarios import (
                    DEFAULT_CLIMATE_SCENARIO,
                    DEFAULT_CLIMATE_TYPE,
                )
                state = State.objects.filter(
                    scenario_name=DEFAULT_CLIMATE_SCENARIO,
                    scenario_type=DEFAULT_CLIMATE_TYPE,
                ).first()
        else:
            # Non-climate indicators (mobility, etc.)
            # Use query params if in prefetch mode, otherwise use globals
            if prefetch_mode and scenario_param:
                # Prefetch mode - look up state by scenario name
                print(f"📊 PREFETCH mode - {indicator_param} scenario: {scenario_param}")
                state = None
                states = State.objects.all()
                for s in states:
                    if s.state_values.get("scenario") == scenario_param:
                        state = s
                        print(f"✓ Found state by scenario: {s.state_values}")
                        break
                if not state:
                    # Fallback to first state
                    state = State.objects.first()
            elif indicator_obj.has_states == False:
                state = State.objects.filter(state_values={}).first()
            else:
                state = State.objects.filter(state_values=globals.INDICATOR_STATE).first()
                if not state:
                    print(f"No exact state match for {globals.INDICATOR_STATE}, trying year match...")
                    year = globals.INDICATOR_STATE.get("year")
                    if year:
                        states = State.objects.all()
                        for s in states:
                            if s.state_values.get("year") == year:
                                state = s
                                print(f"Found state with matching year: {s.state_values}")
                                break

        if not state:
            # Default to the first available state
            # WARNING: Do NOT modify globals.INDICATOR_STATE here - GET endpoints should not have side effects
            state = State.objects.first()
            if state:
                print(f"⚠️ No matching state found for {globals.INDICATOR_STATE}")
                print(
                    f"   Using first available state for image lookup: {state.state_values}"
                )
            else:
                response = JsonResponse({"error": "No states found"}, status=404)
                self._add_no_cache_headers(response)
                return response

        state_obj = state
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

                # Determine if this is a video file
                file_extension = os.path.splitext(image_path)[1].lower()
                is_video = file_extension in [".mp4", ".webm", ".ogg", ".avi", ".mov"]

                response = JsonResponse(
                    {"image_data": image_path, "type": "video" if is_video else "image"}
                )
                self._add_no_cache_headers(response)
                return response
            except (AttributeError, ValueError) as e:
                print(f"Error with image data: {e}")

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

        # Get the indicator and state - default to idistrict table
        idistrict_table = Table.objects.filter(name="idistrict").first()
        if idistrict_table:
            indicator = Indicator.objects.filter(table=idistrict_table, indicator_id=globals.INDICATOR_ID).first()
        else:
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
            # Try to find a state that matches the current indicator state (year + scenario)
            state = State.objects.filter(
                state_values=globals.INDICATOR_STATE
            ).first()
            
            # If no exact match found, try to find a state with the specified year and scenario
            if not state:
                current_scenario = globals.INDICATOR_STATE.get("scenario")
                states = State.objects.all()
                for s in states:
                    if (s.state_values.get("year") == year and 
                        s.state_values.get("scenario") == current_scenario):
                        state = s
                        break

            # If still no state found, use the first state with the year
            if not state:
                states = State.objects.all()
                for s in states:
                    if s.state_values.get("year") == year:
                        state = s
                        break

            # Use first available state if none match
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
            # Check if this is an HTML file (real map)
            if map_url.endswith(".html"):
                # Construct proper path
                if map_url.startswith("/media/"):
                    map_url = map_url[7:]  # Remove /media/ prefix

                file_path = os.path.join(settings.MEDIA_ROOT, map_url)
                if os.path.exists(file_path):
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
                else:
                    print(f"Warning: HTML map file not found at {file_path}")

        # No map data available - return error
        response = JsonResponse(
            {
                "error": "No visualization data available",
                "indicator": indicator.name,
                "state": state.state_values if hasattr(state, "state_values") else {},
                "help": "Please upload visualization data for this indicator and state",
            },
            status=404,
        )
        self._add_no_cache_headers(response)
        return response

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
        # IMPORTANT: Always return globals.INDICATOR_STATE directly for real-time updates
        # DO NOT return state.first().state_values as it may be stale
        try:
            state = State.objects.filter(state_values=globals.INDICATOR_STATE).first()

            if state:
                dashboard_data = DashboardFeedState.objects.filter(state=state).first()

                if dashboard_data:
                    response = JsonResponse(
                        {"data": dashboard_data.data, "state": globals.INDICATOR_STATE}
                    )
                    self._add_no_cache_headers(response)
                    return response

            # If no exact match in DB, still return the current global state
            # This handles cases where the state was just updated
            print(f"⚠️ No database match for state: {globals.INDICATOR_STATE}")
            response = JsonResponse(
                {
                    "data": {},  # Empty data if no match
                    "state": globals.INDICATOR_STATE,
                    "warning": "No dashboard data found for current state",
                }
            )
            self._add_no_cache_headers(response)
            return response

        except Exception as e:
            print(f"❌ Error in get_current_dashboard_data: {e}")
            # Always return current state even on error
            response = JsonResponse(
                {
                    "error": str(e),
                    "state": globals.INDICATOR_STATE,
                },
                status=500,
            )
            self._add_no_cache_headers(response)
            return response


# Custom view to serve map files directly
from django.http import FileResponse, HttpResponse
from django.views.decorators.csrf import csrf_exempt
import os
from django.conf import settings
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

            # Find or create the indicator data entry - default to idistrict table
            try:
                idistrict_table = Table.objects.filter(name="idistrict").first()
                if idistrict_table:
                    indicator = Indicator.objects.get(table=idistrict_table, indicator_id=indicator_id)
                else:
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
