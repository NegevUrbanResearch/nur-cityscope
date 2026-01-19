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
    GISLayer,
    OTEFModelConfig,
    OTEFViewportState,
)

from .serializers import (
    TableSerializer,
    IndicatorSerializer,
    IndicatorDataSerializer,
    IndicatorImageSerializer,
    StateSerializer,
    DashboardFeedStateSerializer,
    LayerConfigSerializer,
    GISLayerSerializer,
    OTEFModelConfigSerializer,
    OTEFViewportStateSerializer,
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
        include_ugc = self.request.query_params.get("include_ugc", "true")

        if table_name:
            queryset = queryset.filter(table__name=table_name)

        # Filter out UGC indicators if requested
        if include_ugc.lower() == "false":
            queryset = queryset.filter(is_user_generated=False)

        return queryset

    def create(self, request, *args, **kwargs):
        """Create a new UGC indicator - automatically marks as user-generated"""
        table_name = request.data.get('table')
        if not table_name and not request.data.get('table_id'):
            return Response(
                {"error": "Table name or table_id is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            if table_name:
                table = Table.objects.get(name=table_name)
            else:
                table = Table.objects.get(id=request.data.get('table_id'))
        except Table.DoesNotExist:
            return Response(
                {"error": f"Table not found"},
                status=status.HTTP_404_NOT_FOUND
            )

        # Copy data and force is_user_generated=True
        data = request.data.copy()
        data['is_user_generated'] = True
        data['table'] = table.id

        # Auto-generate indicator_id if not provided
        if 'indicator_id' not in data:
            max_id = Indicator.objects.filter(table=table).aggregate(
                max_id=models.Max('indicator_id')
            )['max_id'] or 0
            data['indicator_id'] = max_id + 1

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        """Only allow deletion of UGC indicators"""
        instance = self.get_object()
        if not instance.is_user_generated:
            return Response(
                {"error": "Cannot delete preloaded indicators. Only user-generated indicators can be deleted."},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().destroy(request, *args, **kwargs)


class StateViewSet(viewsets.ModelViewSet):
    serializer_class = StateSerializer

    def get_queryset(self):
        queryset = State.objects.all()
        include_ugc = self.request.query_params.get("include_ugc", "true")

        # Filter out UGC states if requested
        if include_ugc.lower() == "false":
            queryset = queryset.filter(is_user_generated=False)

        return queryset

    def create(self, request, *args, **kwargs):
        """Create a new UGC state - automatically marks as user-generated"""
        data = request.data.copy()
        data['is_user_generated'] = True

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        """Only allow deletion of UGC states"""
        instance = self.get_object()
        if not instance.is_user_generated:
            return Response(
                {"error": "Cannot delete preloaded states. Only user-generated states can be deleted."},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().destroy(request, *args, **kwargs)


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


class GISLayerViewSet(viewsets.ModelViewSet):
    """CRUD operations for GIS layers"""
    serializer_class = GISLayerSerializer

    def get_queryset(self):
        queryset = GISLayer.objects.all()
        table_name = self.request.query_params.get('table')
        if table_name:
            queryset = queryset.filter(table__name=table_name)
        return queryset.filter(is_active=True)

    @action(detail=True, methods=['get'])
    def get_layer_geojson(self, request, pk=None):
        """Serve GeoJSON data for a layer (for large files)"""
        layer = self.get_object()
        if layer.layer_type != 'geojson':
            return Response({'error': 'Not a GeoJSON layer'}, status=400)

        if layer.data:
            response = JsonResponse(layer.data, safe=False)
            response['Content-Type'] = 'application/json'
            return response
        elif layer.file_path:
            # Serve file from storage
            import os
            from django.conf import settings
            file_path = os.path.join(settings.MEDIA_ROOT, layer.file_path) if not os.path.isabs(layer.file_path) else layer.file_path
            if os.path.exists(file_path):
                response = FileResponse(open(file_path, 'rb'), content_type='application/json')
                response["Cache-Control"] = "public, max-age=86400"
                return response
            else:
                return Response({'error': 'File not found'}, status=404)

        return Response({'error': 'No data available'}, status=404)


class OTEFModelConfigViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only access to OTEF model configuration"""
    serializer_class = OTEFModelConfigSerializer

    def get_queryset(self):
        queryset = OTEFModelConfig.objects.all()
        table_name = self.request.query_params.get('table')
        if table_name:
            queryset = queryset.filter(table__name=table_name)
        return queryset


class OTEFViewportStateViewSet(viewsets.ModelViewSet):
    """
    Manage OTEF interactive state - single source of truth.

    GET /api/otef_viewport/by-table/{table_name}/ - Get full state
    PATCH /api/otef_viewport/by-table/{table_name}/ - Update state partially
    POST /api/otef_viewport/by-table/{table_name}/command/ - Execute command (pan/zoom)
    """
    serializer_class = OTEFViewportStateSerializer

    def get_queryset(self):
        queryset = OTEFViewportState.objects.all()
        table_name = self.request.query_params.get('table')
        if table_name:
            queryset = queryset.filter(table__name=table_name)
        return queryset

    def _broadcast_state_change(self, table_name, changed_fields):
        """Broadcast WebSocket notifications for state changes."""
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync

        channel_layer = get_channel_layer()
        # Must match consumer's room_group_name: f'{channel_type}_channel'
        group_name = 'otef_channel'

        for field in changed_fields:

            if field == 'viewport':
                message = {
                    'type': 'broadcast_message',
                    'message': {
                        'type': 'otef_viewport_changed',
                        'table': table_name,
                    }
                }
            elif field == 'layers':
                message = {
                    'type': 'broadcast_message',
                    'message': {
                        'type': 'otef_layers_changed',
                        'table': table_name,
                    }
                }
            elif field == 'animations':
                # Get current animation state to include in notification
                try:
                    state = OTEFViewportState.objects.filter(table__name=table_name).first()
                    animations = state.animations if state else {}
                except:
                    animations = {}

                message = {
                    'type': 'broadcast_message',
                    'message': {
                        'type': 'otef_animation_changed',
                        'table': table_name,
                        'layerId': 'parcels',
                        'enabled': animations.get('parcels', False),
                    }
                }
            else:
                continue

            async_to_sync(channel_layer.group_send)(group_name, message)
            print(f"📡 Broadcast: {field} changed for {table_name}")


    @action(detail=False, methods=['get', 'patch'], url_path='by-table/(?P<table_name>[^/.]+)')
    def by_table(self, request, table_name=None):
        """
        GET/PATCH state by table name.

        GET: Returns full state with defaults applied
        PATCH: Partial update of viewport, layers, or animations
        """
        from django.shortcuts import get_object_or_404

        table = get_object_or_404(Table, name=table_name)
        state, created = OTEFViewportState.objects.get_or_create(
            table=table,
            defaults={
                'viewport': OTEFViewportState.DEFAULT_VIEWPORT.copy(),
                'layers': OTEFViewportState.DEFAULT_LAYERS.copy(),
                'animations': {'parcels': False}
            }
        )

        if request.method == 'PATCH':
            changed_fields = []

            # Partial updates for each field
            if 'viewport' in request.data:
                # Merge with existing viewport (preserve unset fields)
                current = state.viewport or {}
                new_viewport = request.data['viewport']
                state.viewport = {**current, **new_viewport}
                changed_fields.append('viewport')

            if 'layers' in request.data:
                state.layers = request.data['layers']
                changed_fields.append('layers')

            if 'animations' in request.data:
                state.animations = request.data['animations']
                changed_fields.append('animations')

            state.save()

            # Broadcast notifications for each changed field
            self._broadcast_state_change(table_name, changed_fields)

        # Return state with defaults applied
        response_data = {
            'id': state.id,
            'table': table.id,
            'table_name': table_name,
            'viewport': state.get_viewport_with_defaults(),
            'layers': state.get_layers_with_defaults(),
            'animations': state.get_animations_with_defaults(),
            'updated_at': state.updated_at.isoformat() if state.updated_at else None,
        }

        return Response(response_data)

    @action(detail=False, methods=['post'], url_path='by-table/(?P<table_name>[^/.]+)/command')
    def command(self, request, table_name=None):
        """
        Execute a command (pan/zoom) server-side without requiring GIS map.

        POST body:
        - Pan: {"action": "pan", "direction": "north", "delta": 0.15}
        - Zoom: {"action": "zoom", "level": 16}
        """
        from django.shortcuts import get_object_or_404

        table = get_object_or_404(Table, name=table_name)
        state, created = OTEFViewportState.objects.get_or_create(
            table=table,
            defaults={
                'viewport': OTEFViewportState.DEFAULT_VIEWPORT.copy(),
                'layers': OTEFViewportState.DEFAULT_LAYERS.copy(),
                'animations': {'parcels': False}
            }
        )

        action = request.data.get('action')

        if action == 'pan':
            direction = request.data.get('direction', 'north')
            delta = float(request.data.get('delta', 0.15))
            state.viewport = state.apply_pan_command(direction, delta)
            state.save()
            self._broadcast_state_change(table_name, ['viewport'])

        elif action == 'zoom':
            level = int(request.data.get('level', 15))
            level = max(10, min(19, level))  # Clamp to valid range
            state.viewport = state.apply_zoom_command(level)
            state.save()
            self._broadcast_state_change(table_name, ['viewport'])

        else:
            return Response(
                {'error': f'Unknown action: {action}. Use "pan" or "zoom".'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Return updated state
        return Response({
            'status': 'ok',
            'action': action,
            'viewport': state.get_viewport_with_defaults(),
        })



# Now lets program the views for the API as an interactive platform

from . import globals
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

def broadcast_presentation_update(table_name=None):
    """Broadcast presentation state to all connected WebSocket clients"""
    channel_layer = get_channel_layer()
    if channel_layer:
        try:
            # If table_name is specified, broadcast only that table's state
            # Otherwise, broadcast all table states
            if table_name:
                state = globals.get_presentation_state(table_name)
                async_to_sync(channel_layer.group_send)(
                    'presentation_channel',
                    {
                        'type': 'presentation_update',
                        'data': {
                            'table': table_name,
                            'is_playing': state["is_playing"],
                            'sequence': state["sequence"],
                            'sequence_index': state["sequence_index"],
                            'duration': state["duration"],
                        }
                    }
                )
            else:
                # Broadcast all table states for backward compatibility and multi-table support
                all_states = {}
                for table in globals.PRESENTATION_STATE_BY_TABLE.keys():
                    all_states[table] = globals.get_presentation_state(table)
                # Also include default table state for legacy clients
                default_state = globals.get_presentation_state(globals.DEFAULT_TABLE_NAME)
                async_to_sync(channel_layer.group_send)(
                    'presentation_channel',
                    {
                        'type': 'presentation_update',
                        'data': {
                            'table': globals.DEFAULT_TABLE_NAME,
                            'is_playing': default_state["is_playing"],
                            'sequence': default_state["sequence"],
                            'sequence_index': default_state["sequence_index"],
                            'duration': default_state["duration"],
                            'all_tables': all_states,  # Include all table states
                        }
                    }
                )
        except Exception as e:
            print(f"WebSocket broadcast error: {e}")

def broadcast_indicator_update(table_name=None):
    """Broadcast indicator state update notification for a specific table

    Note: This sends a lightweight notification. Clients should fetch their
    table-specific state via get_global_variables endpoint rather than
    relying on broadcasted values to avoid cross-tab interference.
    """
    channel_layer = get_channel_layer()
    if channel_layer:
        try:
            # Send notification with table name so clients can filter
            async_to_sync(channel_layer.group_send)(
                'presentation_channel',
                {
                    'type': 'indicator_update',
                    'data': {
                        'table': table_name,
                        'message': 'Indicator state updated - fetch table-specific state'
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
            }
        )
        self._add_no_cache_headers(response)
        return response

    @action(detail=False, methods=["get"])
    def get_file_hierarchy(self, request):
        """
        Get complete table > indicator > state > media hierarchy for file management.
        Returns a tree structure of all data organized by table.
        """
        table_name = request.query_params.get("table")

        tables_query = Table.objects.filter(is_active=True)
        if table_name:
            tables_query = tables_query.filter(name=table_name)

        hierarchy = []
        for table in tables_query.prefetch_related('indicators'):
            table_data = {
                'id': table.id,
                'name': table.name,
                'display_name': table.display_name,
                'description': table.description,
                'indicators': []
            }

            for indicator in table.indicators.all():
                indicator_data = {
                    'id': indicator.id,
                    'indicator_id': indicator.indicator_id,
                    'name': indicator.name,
                    'category': indicator.category,
                    'description': indicator.description,
                    'is_user_generated': indicator.is_user_generated,
                    'has_states': indicator.has_states,
                    'states': []
                }

                # Get states through IndicatorData
                indicator_data_qs = indicator.data.all().select_related('state').prefetch_related('images')
                seen_states = {}

                for ind_data in indicator_data_qs:
                    state = ind_data.state
                    state_id = state.id

                    if state_id not in seen_states:
                        seen_states[state_id] = {
                            'id': state_id,
                            'state_values': state.state_values,
                            'scenario_type': state.scenario_type,
                            'scenario_name': state.scenario_name,
                            'is_user_generated': state.is_user_generated,
                            'indicator_data_id': ind_data.id,
                            'media': []
                        }

                    # Add media for this indicator data
                    for img in ind_data.images.all():
                        # Determine media type from extension if not set
                        media_type = getattr(img, 'media_type', 'image')
                        image_path = None
                        if img.image:
                            image_path = img.image.name

                            # Determine correct URL path based on stored path:
                            # - indicators/, ugc_indicators/ - use as-is
                            # - processed/... (legacy system data) - add indicators/ prefix
                            # - plain filename (no /) - use as-is (stored in media root)
                            valid_prefixes = ('indicators/', 'ugc_indicators/')
                            has_valid_prefix = any(image_path.startswith(p) for p in valid_prefixes)
                            is_plain_filename = '/' not in image_path

                            if not has_valid_prefix and not is_plain_filename:
                                # Legacy system data with path like processed/... - add indicators/ prefix
                                image_path = f"indicators/{image_path}"

                            ext = image_path.split('.')[-1].lower() if '.' in image_path else ''
                            if ext in ['mp4', 'webm', 'ogg', 'avi', 'mov']:
                                media_type = 'video'
                            elif ext in ['html', 'htm']:
                                media_type = 'html_map'
                            elif ext == 'json':
                                media_type = 'deckgl_layer'

                        seen_states[state_id]['media'].append({
                            'id': img.id,
                            'url': image_path,  # Return path without /media/ prefix
                            'media_type': media_type,
                            'uploaded_at': img.uploaded_at.isoformat() if img.uploaded_at else None
                        })

                indicator_data['states'] = list(seen_states.values())
                table_data['indicators'].append(indicator_data)

            hierarchy.append(table_data)

        response = JsonResponse(hierarchy, safe=False)
        self._add_no_cache_headers(response)
        return response

    @action(detail=False, methods=["post"])
    def set_visualization_mode(self, request):
        """Set the visualization mode (image or map) for a specific table"""
        mode = request.data.get("mode", "image")
        table_name = request.data.get("table", globals.DEFAULT_TABLE_NAME)

        if mode not in ["image", "map"]:
            return JsonResponse(
                {
                    "status": "error",
                    "message": 'Invalid mode. Must be "image" or "map"',
                },
                status=400,
            )

        indicator_state = globals.get_indicator_state(table_name)
        indicator_state["visualization_mode"] = mode

        # Update legacy global for default table (backward compatibility)
        if table_name == globals.DEFAULT_TABLE_NAME:
            globals.VISUALIZATION_MODE = mode

        broadcast_indicator_update(table_name)
        print(f"✓ Visualization mode set to: {mode} for table '{table_name}'")

        return JsonResponse({"status": "ok", "visualization_mode": mode, "table": table_name})

    @action(detail=False, methods=["get"])
    def get_presentation_state(self, request):
        """Get current presentation state (playing, sequence, index, duration) for a specific table"""
        # Get table name from query params, default to idistrict for backward compatibility
        table_name = request.query_params.get("table", globals.DEFAULT_TABLE_NAME)
        state = globals.get_presentation_state(table_name)

        response = JsonResponse({
            "table": table_name,
            "is_playing": state["is_playing"],
            "sequence": state["sequence"],
            "sequence_index": state["sequence_index"],
            "duration": state["duration"],
        })
        self._add_no_cache_headers(response)
        return response

    @action(detail=False, methods=["post"])
    def set_presentation_state(self, request):
        """Set presentation state (play/pause, sequence, index, duration) for a specific table"""
        index_changed = False
        sequence_changed = False

        # Get table name from request, default to idistrict for backward compatibility
        table_name = request.data.get("table", globals.DEFAULT_TABLE_NAME)

        # Get presentation state for this table
        state = globals.get_presentation_state(table_name)

        # Update playing state if provided
        if "is_playing" in request.data:
            was_playing = state["is_playing"]
            state["is_playing"] = bool(request.data.get("is_playing"))
            print(f"✓ Presentation playing for table '{table_name}': {state['is_playing']}")
            # If presentation just started playing, sync indicator from current slide
            if state["is_playing"] and not was_playing:
                index_changed = True

        # Update sequence if provided
        if "sequence" in request.data:
            sequence = request.data.get("sequence")
            if isinstance(sequence, list):
                state["sequence"] = sequence
                sequence_changed = True
                print(f"✓ Presentation sequence updated for table '{table_name}': {len(sequence)} slides")

        # Update sequence index if provided
        if "sequence_index" in request.data:
            index = request.data.get("sequence_index")
            if isinstance(index, int):
                # Clamp index to valid range instead of silently ignoring out-of-bounds values
                sequence_length = len(state["sequence"])
                if sequence_length > 0:
                    clamped_index = max(0, min(index, sequence_length - 1))
                    if clamped_index != index:
                        print(f"⚠️ Presentation index {index} out of bounds for table '{table_name}', clamped to {clamped_index}")
                    old_index = state["sequence_index"]
                    state["sequence_index"] = clamped_index
                    index_changed = (clamped_index != old_index)
                    print(f"✓ Presentation index for table '{table_name}': {clamped_index}")
                else:
                    state["sequence_index"] = 0
                    print(f"⚠️ Empty sequence for table '{table_name}', index reset to 0")

        # Update duration if provided
        if "duration" in request.data:
            duration = request.data.get("duration")
            if isinstance(duration, (int, float)) and duration >= 1:
                state["duration"] = int(duration)
                print(f"✓ Presentation duration for table '{table_name}': {duration}s")

        # Update legacy globals for default table (backward compatibility)
        if table_name == globals.DEFAULT_TABLE_NAME:
            globals.PRESENTATION_PLAYING = state["is_playing"]
            globals.PRESENTATION_SEQUENCE = state["sequence"]
            globals.PRESENTATION_SEQUENCE_INDEX = state["sequence_index"]
            globals.PRESENTATION_DURATION = state["duration"]

        # If presentation is playing and (index/sequence changed or just started), update indicator/state from current slide
        if state["is_playing"] and (index_changed or sequence_changed) and state["sequence"]:
            self._sync_indicator_from_presentation_slide(table_name, state)

        # Broadcast to all connected clients via WebSocket
        broadcast_presentation_update(table_name)

        return JsonResponse({
            "status": "ok",
            "table": table_name,
            "is_playing": state["is_playing"],
            "sequence": state["sequence"],
            "sequence_index": state["sequence_index"],
            "duration": state["duration"],
        })

    def _sync_indicator_from_presentation_slide(self, table_name=None, presentation_state=None):
        """Update global indicator and state from current presentation slide for a specific table"""
        try:
            if presentation_state is None:
                if table_name is None:
                    table_name = globals.DEFAULT_TABLE_NAME
                presentation_state = globals.get_presentation_state(table_name)

            if not presentation_state["sequence"] or len(presentation_state["sequence"]) == 0:
                return

            current_index = max(
                0, min(presentation_state["sequence_index"], len(presentation_state["sequence"]) - 1)
            )
            current_slide = presentation_state["sequence"][current_index]

            if not current_slide or not current_slide.get("indicator"):
                return

            indicator_name = current_slide.get("indicator")
            state_name = current_slide.get("state")
            slide_type = current_slide.get("type")

            # Map indicator name to ID
            indicator_mapping = {"mobility": 1, "climate": 2, "land_use": 3}
            indicator_id = indicator_mapping.get(indicator_name)

            if not indicator_id:
                print(f"⚠️ Invalid indicator in presentation slide: {indicator_name}")
                return

            # Get table-specific indicator state
            indicator_state = globals.get_indicator_state(table_name)

            # Update table-specific indicator ID
            indicator_state["indicator_id"] = indicator_id
            print(f"🎬 Synced indicator from presentation (table: {table_name}): {indicator_name} (ID: {indicator_id})")

            # Update table-specific state based on indicator type
            if indicator_name == "climate" and state_name and slide_type:
                # For climate, map display name to scenario key
                from backend.climate_scenarios import CLIMATE_SCENARIO_MAPPING
                scenario_key = None
                for key, config in CLIMATE_SCENARIO_MAPPING.items():
                    if config["display_name"] == state_name:
                        scenario_key = key
                        break

                if scenario_key:
                    # Find the state object to get full state values
                    state_obj = State.objects.filter(
                        scenario_name=scenario_key, scenario_type=slide_type
                    ).first()
                    if state_obj:
                        indicator_state["indicator_state"] = state_obj.state_values.copy()
                        print(f"✓ Synced climate state: {scenario_key} ({slide_type})")
                    else:
                        # Fallback: create minimal state
                        indicator_state["indicator_state"] = {
                            "scenario": scenario_key,
                            "type": slide_type,
                            "label": state_name
                        }
                else:
                    # Fallback: use state name as scenario
                    indicator_state["indicator_state"] = {
                        "scenario": state_name.lower().replace(" ", "_"),
                        "type": slide_type or "utci",
                        "label": state_name
                    }
            else:
                # For mobility and other indicators, find state by scenario name
                if state_name:
                    scenario_key = state_name.lower()
                    states = State.objects.filter(scenario_type="general")
                    state_obj = None
                    for s in states:
                        if s.state_values.get("scenario") == scenario_key:
                            state_obj = s
                            break

                    if state_obj:
                        indicator_state["indicator_state"] = state_obj.state_values.copy()
                        print(f"✓ Synced {indicator_name} state: {scenario_key}")
                    else:
                        # Fallback: create minimal state
                        indicator_state["indicator_state"] = {
                            "scenario": scenario_key,
                            "label": state_name
                        }

            # Update legacy global for default table (backward compatibility)
            if table_name == globals.DEFAULT_TABLE_NAME:
                globals.INDICATOR_ID = indicator_state["indicator_id"]
                globals.INDICATOR_STATE = indicator_state["indicator_state"]

            # Broadcast indicator update for this table only
            broadcast_indicator_update(table_name)
            print(f"✓ Broadcasted indicator update for presentation slide (table: {table_name})")

        except Exception as e:
            print(f"❌ Error syncing indicator from presentation slide: {e}")

    @action(detail=False, methods=["post"])
    def set_current_indicator(self, request):
        indicator_id = request.data.get("indicator_id", "")
        table_name = request.data.get("table")

        if not table_name:
            return JsonResponse(
                {"status": "error", "message": "Table parameter is required"},
                status=400
            )

        if self._set_current_indicator(indicator_id, table_name):
            return JsonResponse({"status": "ok", "indicator_id": indicator_id})
        else:
            return JsonResponse(
                {"status": "error", "message": "Failed to set current indicator"},
                status=404
            )

    def _set_current_indicator(self, indicator_id, table_name):
        try:
            # Pause presentation for this table when dashboard is actively using it
            presentation_state = globals.get_presentation_state(table_name)
            if presentation_state["is_playing"]:
                presentation_state["is_playing"] = False
                print(f"⏸️ Paused presentation for table '{table_name}' (dashboard is using it)")
                # Broadcast the pause
                broadcast_presentation_update(table_name)

            table = Table.objects.filter(name=table_name).first()
            if not table:
                print(f"❌ Table '{table_name}' not found")
                return False

            indicator = Indicator.objects.filter(table=table, indicator_id=indicator_id).first()
            if not indicator:
                print(f"❌ Indicator with ID {indicator_id} not found in table '{table_name}'")
                return False

            globals.INDICATOR_ID = indicator_id
            print(f"✓ Indicator set to ID: {indicator_id} (table: {table_name})")

            # Update INDICATOR_STATE to match the new indicator's default state
            if indicator.category == "climate":
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
        table_name = request.data.get("table", globals.DEFAULT_TABLE_NAME)
        try:
            state = State.objects.get(id=state_id)
            if self._set_current_state(state.state_values, table_name):
                return JsonResponse({"status": "ok", "state": state.state_values, "table": table_name})
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

            table_name = request.data.get("table", globals.DEFAULT_TABLE_NAME)
            if self._set_current_state(new_state, table_name):
                indicator_state = globals.get_indicator_state(table_name)
                print(
                    f"✓ Climate scenario set successfully: {scenario_name} ({scenario_type}) for table '{table_name}'"
                )
                print(f"✓ Indicator state is now: {indicator_state['indicator_state']}")
                return JsonResponse(
                    {
                        "status": "ok",
                        "scenario": scenario_name,
                        "type": scenario_type,
                        "state": new_state,
                        "table": table_name,
                    }
                )
            else:
                return JsonResponse(
                    {"status": "error", "message": "Failed to set climate scenario"}
                )
        except Exception as e:
            print(f"Error setting climate scenario: {e}")
            return JsonResponse({"status": "error", "message": str(e)}, status=500)

    def _set_current_state(self, state, table_name=None):
        """Set the current indicator state for a specific table"""
        try:
            if table_name is None:
                table_name = globals.DEFAULT_TABLE_NAME

            indicator_state = globals.get_indicator_state(table_name)
            indicator_state["indicator_state"] = state
            print(f"✓ State updated to: {state} (table: {table_name})")

            # Update legacy global for default table (backward compatibility)
            if table_name == globals.DEFAULT_TABLE_NAME:
                globals.INDICATOR_STATE = state

            broadcast_indicator_update(table_name)
            return True
        except Exception as e:
            print(f"❌ Error setting state: {e}")
            return False

    @action(detail=False, methods=["get"])
    def get_image_data(self, request):
        # Ensure we have a default state
        self._initialize_default_state()

        # Check if query parameters were provided for PREFETCH mode
        # This allows fetching specific images without modifying globals
        indicator_param = request.query_params.get("indicator")  # Indicator name from request
        scenario_param = request.query_params.get("scenario")  # For prefetching specific states
        type_param = request.query_params.get("type")  # For climate type (utci/plan)
        prefetch_mode = scenario_param is not None  # If scenario is specified, don't use globals

        # Get table name (required parameter)
        table_name = request.query_params.get("table")
        if not table_name:
            response = JsonResponse(
                {"error": "Table parameter is required"},
                status=400
            )
            self._add_no_cache_headers(response)
            return response

        # Get presentation state for this table
        presentation_state = globals.get_presentation_state(table_name)

        # Indicator name to ID mapping
        indicator_mapping = {"mobility": 1, "climate": 2, "land_use": 3}

        # Initialize effective_indicator_id (will be set based on mode)
        effective_indicator_id = None
        is_ugc = False
        indicator_db_id = None
        slide_state_id = None

        # Check if presentation mode is active and should override normal behavior
        # Only use presentation mode if NOT in prefetch mode (prefetch has explicit params)
        use_presentation_mode = (
            not prefetch_mode
            and presentation_state["is_playing"]
            and presentation_state["sequence"]
            and len(presentation_state["sequence"]) > 0
        )

        if use_presentation_mode:
            # Get current slide from presentation sequence for this table
            current_index = max(
                0, min(presentation_state["sequence_index"], len(presentation_state["sequence"]) - 1)
            )
            current_slide = presentation_state["sequence"][current_index]

            if current_slide and current_slide.get("indicator") and current_slide.get("state"):
                # Extract indicator and state from current slide
                slide_indicator = current_slide.get("indicator")
                slide_state = current_slide.get("state")
                slide_type = current_slide.get("type")  # For climate slides

                # Check if this is a UGC indicator
                is_ugc = slide_indicator.startswith('ugc_')
                if is_ugc:
                    # Extract database ID from "ugc_123" format
                    try:
                        indicator_db_id = int(slide_indicator.replace('ugc_', ''))
                        slide_state_id = current_slide.get('stateId')
                        print(f"🎬 Presentation mode active (UGC) - using slide {current_index + 1}/{len(presentation_state['sequence'])} for table '{table_name}'")
                        print(f"   UGC Indicator ID: {indicator_db_id}, State ID: {slide_state_id}, State: {slide_state}")
                        # Set prefetch_mode to True so we use the params instead of globals
                        prefetch_mode = True
                        indicator_param = slide_indicator
                    except (ValueError, AttributeError) as e:
                        print(f"⚠️ Error parsing UGC indicator ID from '{slide_indicator}': {e}")
                        use_presentation_mode = False
                        is_ugc = False
                else:
                    # Map indicator name to ID for standard indicators
                    effective_indicator_id = indicator_mapping.get(slide_indicator)

                    if effective_indicator_id:
                        print(f"🎬 Presentation mode active - using slide {current_index + 1}/{len(presentation_state['sequence'])} for table '{table_name}'")
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

        # Get table-specific indicator state
        indicator_state = globals.get_indicator_state(table_name)

        # Determine which indicator to use (if not already set by presentation mode)
        if not use_presentation_mode or effective_indicator_id is None:
            if indicator_param:
                indicator_id = indicator_mapping.get(indicator_param)
                if indicator_id and not prefetch_mode:
                    # Only modify table-specific state if NOT in prefetch mode
                    indicator_state["indicator_id"] = indicator_id
                    # Update legacy global for default table (backward compatibility)
                    if table_name == globals.DEFAULT_TABLE_NAME:
                        globals.INDICATOR_ID = indicator_id
            else:
                indicator_id = indicator_state["indicator_id"]

            # Use the indicator_id we determined (either from param or table-specific state)
            effective_indicator_id = indicator_mapping.get(indicator_param) if indicator_param else indicator_state["indicator_id"]
        # else: effective_indicator_id was already set above from presentation slide

        # Debug (reduced logging in prefetch mode, but show presentation mode info)
        if not prefetch_mode or use_presentation_mode:
            if use_presentation_mode:
                print(f"Current indicator_id (from presentation): {effective_indicator_id} (table: {table_name})")
            else:
                print(f"Current indicator_id: {indicator_state['indicator_id']} (table: {table_name})")
                print(f"Current state: {indicator_state['indicator_state']}")
                print(f"Visualization mode: {indicator_state['visualization_mode']}")

        # Table name already retrieved above for presentation mode check
        exclude_ugc = request.query_params.get("exclude_ugc", "false").lower() == "true"

        table = Table.objects.filter(name=table_name).first()
        if not table:
            response = JsonResponse(
                {"error": f"Table '{table_name}' not found"},
                status=404
            )
            self._add_no_cache_headers(response)
            return response

        # Handle UGC indicators differently - look up by database ID instead of indicator_id
        if is_ugc and indicator_db_id:
            indicator = Indicator.objects.filter(id=indicator_db_id, table=table).first()
            if not indicator:
                response = JsonResponse(
                    {"error": f"UGC Indicator with database ID {indicator_db_id} not found in table '{table_name}'"},
                    status=404
                )
                self._add_no_cache_headers(response)
                return response
            indicator_obj = indicator
        else:
            # Standard indicator lookup by indicator_id
            indicator = Indicator.objects.filter(table=table, indicator_id=effective_indicator_id)

            if not indicator.exists() or not indicator.first():
                response = JsonResponse(
                    {"error": f"Indicator with ID {effective_indicator_id} not found in table '{table_name}'"},
                    status=404
                )
                self._add_no_cache_headers(response)
                return response

            indicator_obj = indicator.first()

        # Check if UGC should be excluded (for dashboard use)
        if exclude_ugc and indicator_obj.is_user_generated:
            response = JsonResponse(
                {"error": "UGC indicators not available on dashboard", "is_ugc": True},
                status=404
            )
            self._add_no_cache_headers(response)
            return response

        # Handle UGC indicators - use stateId directly from presentation slide
        if is_ugc and slide_state_id:
            state = State.objects.filter(id=slide_state_id).first()
            if not state:
                print(f"⚠️ UGC state with ID {slide_state_id} not found")
                response = JsonResponse(
                    {"error": f"State with ID {slide_state_id} not found"},
                    status=404
                )
                self._add_no_cache_headers(response)
                return response
            print(f"✓ Found UGC state by ID: {slide_state_id}")
        # Special handling for climate scenarios
        elif indicator_obj.category == "climate":
            # Use query params if in prefetch mode, otherwise use table-specific state
            if prefetch_mode and scenario_param:
                scenario_name = scenario_param
                scenario_type = type_param or "utci"
                print(f"🌡️ PREFETCH mode - climate scenario: {scenario_name}, type: {scenario_type} (table: {table_name})")
            else:
                scenario_name = indicator_state["indicator_state"].get("scenario")
                scenario_type = indicator_state["indicator_state"].get("type", "utci")
                print(f"🌡️ get_image_data for climate - scenario: {scenario_name}, type: {scenario_type} (table: {table_name})")

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
            # WARNING: Do NOT modify indicator_state here - GET endpoints should not have side effects
            state = State.objects.first()
            if state:
                print(f"⚠️ No matching state found for {indicator_state['indicator_state']} (table: {table_name})")
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
                # UGC indicators already have ugc_indicators/ prefix from upload_to function
                # Standard indicators may need indicators/ prefix added
                # Don't modify paths that already have a valid prefix
                valid_prefixes = ('indicators/', 'ugc_indicators/')
                has_valid_prefix = any(image_path.startswith(p) for p in valid_prefixes)

                if not has_valid_prefix:
                    # Only add indicators/ prefix for non-UGC indicators
                    if is_ugc:
                        # UGC indicators should already have ugc_indicators/ prefix, but handle edge case
                        image_path = f"ugc_indicators/{image_path}"
                    else:
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

        # Get the indicator and state - table parameter is required
        table_name = request.query_params.get("table")
        if not table_name:
            response = JsonResponse(
                {"error": "Table parameter is required"},
                status=400,
            )
            return response

        table = Table.objects.filter(name=table_name).first()
        if not table:
            response = JsonResponse(
                {"error": f"Table '{table_name}' not found"},
                status=404,
            )
            return response

        # Get table-specific indicator state
        indicator_state = globals.get_indicator_state(table_name)

        # Check if an indicator parameter was provided
        indicator_param = request.query_params.get("indicator")
        if indicator_param:
            # Map the indicator name to ID
            indicator_mapping = {"mobility": 1, "climate": 2, "land_use": 3}
            indicator_id = indicator_mapping.get(indicator_param)
            if indicator_id:
                indicator_state["indicator_id"] = indicator_id
                # Update legacy global for default table (backward compatibility)
                if table_name == globals.DEFAULT_TABLE_NAME:
                    globals.INDICATOR_ID = indicator_id
                print(
                    f"Using indicator from query parameter: {indicator_param} (ID: {indicator_id}) (table: {table_name})"
                )

        # Get year from table-specific state or query param
        year = indicator_state["indicator_state"].get("year", 2023)
        year_param = request.query_params.get("year")
        if year_param and year_param.isdigit():
            year = int(year_param)

        indicator = Indicator.objects.filter(table=table, indicator_id=indicator_state["indicator_id"]).first()
        if not indicator:
            response = JsonResponse(
                {"error": f"Indicator with ID {indicator_state['indicator_id']} not found in table '{table_name}'"},
                status=404,
            )
            return response

        # Get state based on indicator and year
        if indicator.has_states == False:
            state = State.objects.filter(state_values={}).first()
        else:
            # Try to find a state that matches the current table-specific indicator state (year + scenario)
            state = State.objects.filter(
                state_values=indicator_state["indicator_state"]
            ).first()

            # If no exact match found, try to find a state with the specified year and scenario
            if not state:
                current_scenario = indicator_state["indicator_state"].get("scenario")
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

    @action(detail=False, methods=['get'])
    def get_otef_layers(self, request):
        """Get all active GIS layers for a table"""
        table_name = request.query_params.get('table', 'otef')
        table = Table.objects.filter(name=table_name).first()
        if not table:
            return Response({'error': 'Table not found'}, status=404)

        layers = GISLayer.objects.filter(table=table, is_active=True).order_by('order')
        data = []
        for layer in layers:
            layer_data = {
                'id': layer.id,
                'name': layer.name,
                'display_name': layer.display_name,
                'layer_type': layer.layer_type,
                'style_config': layer.style_config,
            }

            # For GeoJSON, include data or URL
            if layer.layer_type == 'geojson':
                if layer.data:
                    layer_data['geojson'] = layer.data
                elif layer.file_path:
                    layer_data['url'] = f'/api/gis_layers/{layer.id}/get_layer_geojson/'

            data.append(layer_data)

        response = JsonResponse(data, safe=False)
        # Enable caching for layer list (1 day) - significantly speeds up subsequent loads
        response["Cache-Control"] = "public, max-age=86400"
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

            # Find or create the indicator data entry - table parameter is required
            table_name = request.data.get("table")
            if not table_name:
                return Response(
                    {"error": "Table parameter is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                table = Table.objects.filter(name=table_name).first()
                if not table:
                    return Response(
                        {"error": f"Table '{table_name}' not found"},
                        status=status.HTTP_404_NOT_FOUND,
                    )

                indicator = Indicator.objects.get(table=table, indicator_id=indicator_id)
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
