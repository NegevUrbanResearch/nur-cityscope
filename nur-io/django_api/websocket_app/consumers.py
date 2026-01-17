# consumers.py
from channels.generic.websocket import AsyncWebsocketConsumer
import json

class GeneralConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for real-time presentation state sync"""
    
    async def connect(self):
        # Get channel type from URL (e.g., 'presentation', 'map', 'dashboard')
        self.channel_type = self.scope['url_route']['kwargs']['channel_type']
        self.room_group_name = f'{self.channel_type}_channel'
        
        # Join the channel group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        
        await self.accept()
        print(f"✓ WebSocket connected: {self.channel_type} ({self.channel_name[:8]}...)")

    async def disconnect(self, close_code):
        # Leave the channel group
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )
        print(f"✗ WebSocket disconnected: {self.channel_type}")

    async def receive(self, text_data):
        """Handle incoming messages from clients"""
        try:
            data = json.loads(text_data)
            message_type = data.get('type', 'unknown')
            
            # Handle OTEF-specific messages
            if message_type.startswith('otef_'):
                await self.handle_otef_message(data)
            else:
                # Existing message handling
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'broadcast_message',
                        'message': data
                    }
                )
        except json.JSONDecodeError:
            print(f"Invalid JSON received: {text_data}")
    
    async def handle_otef_message(self, data):
        """Handle OTEF-specific WebSocket messages"""
        from backend.models import OTEFViewportState, Table
        from asgiref.sync import sync_to_async
        
        message_type = data.get('type')
        table_name = data.get('table', 'otef')
        
        if message_type == 'otef_viewport_update':
            # Persist viewport state to database
            try:
                await self._update_viewport_state(table_name, data)
            except Exception as e:
                print(f"Error updating viewport state: {e}")
        
        # Broadcast to all clients
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'broadcast_message',
                'message': data
            }
        )
    
    async def _update_viewport_state(self, table_name, data):
        """Update viewport state in database"""
        from backend.models import OTEFViewportState, Table
        from asgiref.sync import sync_to_async
        
        def _sync_update():
            table = Table.objects.filter(name=table_name).first()
            if not table:
                return
            
            viewport_state, _ = OTEFViewportState.objects.get_or_create(table=table)
            viewport_state.viewport = data.get('viewport', {})
            viewport_state.layers = data.get('layers', {})
            viewport_state.save()
        
        await sync_to_async(_sync_update)()

    async def broadcast_message(self, event):
        """Send message to WebSocket client"""
        message = event['message']
        await self.send(text_data=json.dumps(message))

    async def presentation_update(self, event):
        """Handle presentation state updates from backend"""
        await self.send(text_data=json.dumps({
            'type': 'presentation_update',
            'data': event['data']
        }))

    async def indicator_update(self, event):
        """Handle indicator/state updates from backend"""
        await self.send(text_data=json.dumps({
            'type': 'indicator_update', 
            'data': event['data']
        }))
