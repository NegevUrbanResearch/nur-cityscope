from django.shortcuts import render
from django.db import models
from django.http import JsonResponse
from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action
import json
import os
from django.conf import settings

from .models import (
    Indicator, IndicatorData, IndicatorImage, IndicatorGeojson,
    State, DashboardFeedState, LayerConfig, MapType
)

from .serializers import (
    IndicatorSerializer, IndicatorDataSerializer, IndicatorImageSerializer,
    IndicatorGeojsonSerializer, StateSerializer, DashboardFeedStateSerializer,
    StateSerializer, LayerConfigSerializer, MapTypeSerializer
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
        dashboard_type = self.request.query_params.get('dashboard_type', None)
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
                print(f"Looking for default state with values: {globals.DEFAULT_STATES}")
                
                # First attempt: exact match
                state = State.objects.filter(state_values=globals.DEFAULT_STATES).first()
                
                # Second attempt: match just the year and scenario
                if not state:
                    print("Exact match not found, trying partial match...")
                    year = globals.DEFAULT_STATES.get('year')
                    scenario = globals.DEFAULT_STATES.get('scenario')
                    states = State.objects.all()
                    for s in states:
                        if (s.state_values.get('year') == year and 
                            s.state_values.get('scenario') == scenario):
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
                    print(f"No states in database. Using fallback default: {globals.INDICATOR_STATE}")
            except Exception as e:
                print(f"Error initializing default state: {e}")
                # Minimal fallback
                globals.INDICATOR_STATE = {'year': 2023}

    def check_and_send_data(self):
        # Si la condición es válida, enviamos los datos a los consumidores
        channel_layer = get_channel_layer()
        message = {
            'indicator_id': globals.INDICATOR_ID,
            'indicator_state': globals.INDICATOR_STATE,
            'visualization_mode': globals.VISUALIZATION_MODE
        }
        print(message)
    
    @action(detail=False, methods=['get'])
    def get_global_variables(self, request):
        return JsonResponse({
            'indicator_id': globals.INDICATOR_ID,
            'indicator_state': globals.INDICATOR_STATE,
            'visualization_mode': globals.VISUALIZATION_MODE
        })

    @action(detail=False, methods=['post'])
    def set_visualization_mode(self, request):
        """Set the visualization mode (image or map)"""
        mode = request.data.get('mode', 'image')
        
        if mode not in ['image', 'map']:
            return JsonResponse({
                'status': 'error', 
                'message': 'Invalid mode. Must be "image" or "map"'
            }, status=400)
        
        globals.VISUALIZATION_MODE = mode
        self.check_and_send_data()
        
        return JsonResponse({
            'status': 'ok', 
            'visualization_mode': mode
        })

    @action(detail=False, methods=['post'])
    def set_current_indicator(self, request):
        indicator_id = request.data.get('indicator_id', '')
        if self._set_current_indicator(indicator_id):
            return JsonResponse({'status': 'ok', 'indicator_id': indicator_id})
        else:
            return JsonResponse({'status': 'error', 'message': 'Failed to set current indicator'})
    
    def _set_current_indicator(self, indicator_id):
        try:
            globals.INDICATOR_ID = indicator_id
            self.check_and_send_data()
            return True
        except Exception as e:
            print(e)
            return False

    @action(detail=False, methods=['post'])
    def set_current_state(self, request):
        state_id = request.data.get('state_id')
        try:
            state = State.objects.get(id=state_id)
            if self._set_current_state(state.state_values):
                return JsonResponse({'status': 'ok', 'state': state.state_values})
            else:
                return JsonResponse({'status': 'error', 'message': 'Failed to set current state'})
        except State.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': 'State not found'}, status=404)
        except Exception as e:
            print(e)
            return JsonResponse({'status': 'error', 'message': str(e)}, status=500)

    def _set_current_state(self, state):
        try:
            globals.INDICATOR_STATE = state
            self.check_and_send_data()
            return True
        except Exception as e:
            print(e)
            return False

    @action(detail=False, methods=['get'], url_path='set_map_state')
    def receive_data_from_rfid(self, request):
        slots_param = request.GET.get('slots', '')
        # print('slots_param ', slots_param)
        keys = globals.INDICATOR_STATE.keys()
        # print('INDICATOR_STATE', globals.INDICATOR_STATE)
        print('list_temp', globals.list_temp)
        states = {f"{key}": 0 for key in keys}
        # print('states ', states)
        if slots_param:
            # print('globals.SLOTS_IDS', globals.SLOTS_IDS)
            rfid_tags = sorted(slots_param.split(','))
            # print('rfid_tags ', rfid_tags)

            # print('len(globals.list_temp)', len(globals.list_temp))
            # print('len(globals.INDICATOR_STATE)', len(globals.INDICATOR_STATE))
            if(len(globals.list_temp) != len(globals.INDICATOR_STATE)):
                # print(f'Number of tags reported: {len(rfid_tags)}')
                globals.list_temp += rfid_tags
                globals.list_temp = list(set(globals.list_temp))
                return JsonResponse({'status': 'ok', 'message': 'RFID tag has been saved'})
            else:
                print('All tags reported')
                for pos, rfid_tag in enumerate(globals.list_temp):
                    # print('rfid_tag ', rfid_tag)
                    if rfid_tag not in globals.SLOTS_IDS:
                        continue
                    else:
                        # print(globals.SLOTS_IDS[rfid_tag])
                        (SLOT, STATE) = globals.SLOTS_IDS[rfid_tag]
                        # print('SLOT ', SLOT)
                        # print('STATE ', STATE)
                        states[f'{SLOT}'] = STATE
                # print('states ', states)
                setted = self._set_current_state(states)
                globals.list_temp = []
                # print('setted ', setted)
                print('New state setted: ', globals.INDICATOR_STATE)
                if setted:
                    return JsonResponse({'status': 'ok', 'states': states})
                else:
                    return JsonResponse({'status': 'error', 'message': 'Failed to set current state'})

    @action(detail=False, methods=['get'])
    def receive_data_from_buttons_page(self, request):
        print(request.body)
        if request.method == 'GET':
            type_param = request.GET.get('map_type', 1)
            self._set_current_indicator(type_param)

    @action(detail=False, methods=['get'])
    def get_image_data(self, request):
        # Ensure we have a default state
        self._initialize_default_state()
        
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
                print(f"Using fallback indicator: {indicator.name} (ID: {indicator.indicator_id})")
            else:
                return JsonResponse({'error': 'No indicators found'}, status=404)
            
        indicator_obj = indicator.first()
        # Try to find a state matching the current indicator state
        if indicator_obj.has_states == False:
            state = State.objects.filter(state_values={})
        else:
            # Try exact match first
            state = State.objects.filter(state_values=globals.INDICATOR_STATE)
            
            # If no exact match, try matching just the year field
            if not state.exists():
                print(f"No exact state match for {globals.INDICATOR_STATE}, trying year match...")
                year = globals.INDICATOR_STATE.get('year')
                if year:
                    states = State.objects.all()
                    for s in states:
                        if s.state_values.get('year') == year:
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
                return JsonResponse({'error': 'No states found'}, status=404)
        
        state_obj = state.first()
        indicator_data = IndicatorData.objects.filter(
            indicator=indicator_obj,
            state=state_obj
        )
        
        if not indicator_data.exists() or not indicator_data.first():
            # Try to find any indicator data for this indicator
            indicator_data = IndicatorData.objects.filter(indicator=indicator_obj)
            if indicator_data.exists():
                print(f"Found alternative indicator data with state {indicator_data.first().state.state_values}")
            else:
                print(f"No indicator data found for {indicator_obj.name}")
                return JsonResponse({'error': 'No indicator data found'}, status=404)
        
        # Use globals.VISUALIZATION_MODE to determine what to return
        if globals.VISUALIZATION_MODE == 'image':
            # Try to get image data first
            indicator_data_obj = indicator_data.first()
            image_data = IndicatorImage.objects.filter(indicatorData=indicator_data_obj)
            
            # Check if image_data exists and has a first element
            if image_data.exists() and image_data.first():
                try:
                    image_path = image_data.first().image.name
                    # Ensure the path has the indicators/ prefix if not already present
                    if not image_path.startswith('indicators/'):
                        image_path = f'indicators/{image_path}'
                    return JsonResponse({'image_data': image_path, 'type': 'image'})
                except (AttributeError, ValueError) as e:
                    print(f"Error with image data: {e}")
                    # Continue to map fallback
        
        # Default to map if visualization_mode is 'map' or no image is found
        try:
            indicator_name = indicator_obj.name
            state_year = state_obj.state_values.get('year', 2023) if state_obj and hasattr(state_obj, 'state_values') else 2023
            category = indicator_obj.category
            
            # Try several fallback options for finding a map
            map_options = [
                # Option 1: Exact match for indicator name and year
                f"maps/{indicator_name.replace('[SAMPLE] ', '').replace(' ', '_').lower()}_{state_year}.html",
                # Option 2: Category-based match for current year
                f"maps/{category}_{state_year}.html",
                # Option 3: Indicator name only (any year)
                f"maps/{indicator_name.replace('[SAMPLE] ', '').replace(' ', '_').lower()}_2023.html",
                # Option 4: Category only (current year)
                f"maps/{category}_2023.html"
            ]
            
            import os
            from django.conf import settings
            
            # Check each option
            for map_path in map_options:
                full_path = os.path.join(settings.MEDIA_ROOT, map_path)
                if os.path.exists(full_path):
                    print(f"Found map: {map_path}")
                    return JsonResponse({'image_data': map_path, 'type': 'map'})
            
            # Last resort - check all .html files in the maps directory and use any one
            maps_dir = os.path.join(settings.MEDIA_ROOT, 'maps')
            if os.path.exists(maps_dir):
                html_files = [f for f in os.listdir(maps_dir) if f.endswith('.html')]
                if html_files:
                    map_path = f"maps/{html_files[0]}"
                    print(f"Using fallback map: {map_path}")
                    return JsonResponse({'image_data': map_path, 'type': 'map'})
        except Exception as e:
            print(f"Error finding map: {e}")
        
        # If we get here, no suitable files were found
        return JsonResponse({
            'error': 'No visualization found',
            'indicator': indicator_obj.name,
            'state': state_obj.state_values if state_obj and hasattr(state_obj, 'state_values') else {},
            'media_root': settings.MEDIA_ROOT
        }, status=404)

    @action(detail=False, methods=['get'])
    def get_geojson_data(self, request):
        indicator = Indicator.objects.filter(indicator_id=globals.INDICATOR_ID)
        if(indicator.first().has_states == False):
            state = State.objects.filter(state_values={})
        else:
            state = State.objects.filter(state_values=globals.INDICATOR_STATE)
        
        indicator_data = IndicatorData.objects.filter(
            indicator=indicator.first(),
            state=state.first()
        )
        geojson_data = IndicatorGeojson.objects.filter(indicatorData=indicator_data.first())
        return JsonResponse({'geojson_data': geojson_data.first().geojson})

    @action(detail=False, methods=['get'])
    def get_current_dashboard_data(self, request):
        state = State.objects.filter(state_values=globals.INDICATOR_STATE)
        dashboard_data = DashboardFeedState.objects.filter(
            state=state.first()
        ).first()
        return JsonResponse({'data': dashboard_data.data, 'state': state.first().state_values})


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
            indicator_id = request.data.get('indicator_id')
            state_id = request.data.get('state_id')
            image_file = request.FILES.get('image')
            
            if not all([indicator_id, state_id, image_file]):
                return Response({
                    'error': 'Missing required field',
                    'required_fields': ['indicator_id', 'state_id', 'image']
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Find or create the indicator data entry
            try:
                indicator = Indicator.objects.get(indicator_id=indicator_id)
                state = State.objects.get(id=state_id)
                
                indicator_data, created = IndicatorData.objects.get_or_create(
                    indicator=indicator,
                    state=state
                )
                
                # Create image with proper file validation
                image_extension = Path(image_file.name).suffix.lower()
                allowed_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.svg']
                
                if image_extension not in allowed_extensions:
                    return Response({
                        'error': 'Invalid file type',
                        'allowed_types': allowed_extensions
                    }, status=status.HTTP_400_BAD_REQUEST)
                
                # Create a unique filename
                indicator_name = indicator.name.replace(' ', '_').lower()
                state_year = state.state_values.get('year', 2023)
                category = indicator.category
                
                # Generate path based on indicator category
                folder_path = f"indicators/{category}"
                os.makedirs(os.path.join(settings.MEDIA_ROOT, folder_path), exist_ok=True)
                
                # Create a filename based on indicator and state
                filename = f"{indicator_name}_{state_year}{image_extension}"
                file_path = f"{folder_path}/{filename}"
                
                # Save the image in the database and file system
                image = IndicatorImage.objects.create(
                    indicatorData=indicator_data,
                    image=file_path
                )
                
                # Save the file to disk
                with open(os.path.join(settings.MEDIA_ROOT, file_path), 'wb+') as destination:
                    for chunk in image_file.chunks():
                        destination.write(chunk)
                
                # Assert correct file permissions
                os.chmod(os.path.join(settings.MEDIA_ROOT, file_path), 0o644)
                
                return Response({
                    'status': 'success',
                    'message': 'Image uploaded successfully',
                    'image_url': f"/media/{file_path}",
                    'image_id': image.id
                }, status=status.HTTP_201_CREATED)
                
            except Indicator.DoesNotExist:
                return Response({'error': 'Indicator not found'}, status=status.HTTP_404_NOT_FOUND)
            except State.DoesNotExist:
                return Response({'error': 'State not found'}, status=status.HTTP_404_NOT_FOUND)
            
        except Exception as e:
            return Response({
                'error': f'Failed to upload image: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

