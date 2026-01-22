# consumers.py
"""
WebSocket consumer for OTEF interactive - database-first pattern.

All state is persisted to PostgreSQL via OTEFViewportState model.
WebSocket is used for:
1. Broadcasting change notifications (otef_*_changed)
2. Forwarding commands to connected GIS maps (optional, for real-time control)
"""
from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
import json


class GeneralConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for real-time state sync and notifications"""

    async def connect(self):
        # Get channel type from URL (e.g., 'presentation', 'otef', 'dashboard')
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
                # Generic broadcast for other message types
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
        """
        Handle OTEF-specific WebSocket messages.

        Message types:
        - otef_viewport_control: Pan/zoom command → save to DB, broadcast notification
        - otef_layer_update: Layer visibility → save to DB, broadcast notification
        - otef_animation_toggle: Animation state → save to DB, broadcast notification
        - otef_viewport_update: Viewport from GIS map → save to DB, broadcast notification
        """
        message_type = data.get('type')
        table_name = data.get('table', 'otef')

        if message_type == 'otef_viewport_control':
            # Pan/zoom command - either execute server-side or forward to GIS
            action = data.get('action')

            if action == 'pan':
                await self._execute_pan_command(table_name, data)
            elif action == 'zoom':
                await self._execute_zoom_command(table_name, data)
            else:
                # Forward command to any connected GIS maps for real-time execution
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {'type': 'broadcast_message', 'message': data}
                )

        elif message_type == 'otef_layer_update':
            # Layer visibility change
            await self._save_layers(table_name, data.get('layers', {}))

        elif message_type == 'otef_animation_toggle':
            # Animation state change
            await self._save_animation(table_name, data.get('layerId'), data.get('enabled', False))

        elif message_type == 'otef_viewport_update':
            # Viewport update from GIS map
            await self._save_viewport(table_name, data)

        elif message_type == 'otef_velocity_update':
            # NEW: Velocity relay (transient bypass)
            # Broadcast to all clients including the sender
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'broadcast_message',
                    'message': {
                        'type': 'otef_velocity_sync',
                        'table': table_name,
                        'vx': data.get('vx', 0),
                        'vy': data.get('vy', 0),
                        'sourceId': data.get('sourceId'),
                        'timestamp': data.get('timestamp')
                    }
                }
            )

        else:
            # Unknown OTEF message - just broadcast
            await self.channel_layer.group_send(
                self.room_group_name,
                {'type': 'broadcast_message', 'message': data}
            )

    async def _execute_pan_command(self, table_name, data):
        """Execute pan command server-side and broadcast result"""
        from backend.models import OTEFViewportState, Table

        direction = data.get('direction', 'north')
        delta = float(data.get('delta', 0.15))

        def _sync():
            table = Table.objects.filter(name=table_name).first()
            if not table:
                return None

            state, _ = OTEFViewportState.objects.get_or_create(
                table=table,
                defaults={
                    'viewport': OTEFViewportState.DEFAULT_VIEWPORT.copy(),
                    'layers': OTEFViewportState.DEFAULT_LAYERS.copy(),
                    'animations': {'parcels': False}
                }
            )

            base_viewport = data.get('base_viewport')
            if base_viewport:
                # Update state with client's latest viewport before applying delta
                state.viewport = base_viewport

            state.viewport = state.apply_pan_command(direction, delta)
            state.save()
            return state.viewport

        viewport = await sync_to_async(_sync)()

        if viewport:
            # Broadcast viewport change notification
            await self._broadcast_change(table_name, 'viewport', viewport)

    async def _execute_zoom_command(self, table_name, data):
        """Execute zoom command server-side and broadcast result"""
        from backend.models import OTEFViewportState, Table

        level = int(data.get('zoom', data.get('level', 15)))
        level = max(10, min(19, level))

        def _sync():
            table = Table.objects.filter(name=table_name).first()
            if not table:
                return None

            state, _ = OTEFViewportState.objects.get_or_create(
                table=table,
                defaults={
                    'viewport': OTEFViewportState.DEFAULT_VIEWPORT.copy(),
                    'layers': OTEFViewportState.DEFAULT_LAYERS.copy(),
                    'animations': {'parcels': False}
                }
            )

            base_viewport = data.get('base_viewport')
            if base_viewport:
                state.viewport = base_viewport

            state.viewport = state.apply_zoom_command(level)
            state.save()
            return state.viewport

        viewport = await sync_to_async(_sync)()

        if viewport:
            await self._broadcast_change(table_name, 'viewport', viewport)

    async def _save_viewport(self, table_name, data):
        """Save viewport to DB and broadcast notification"""
        from backend.models import OTEFViewportState, Table

        viewport_data = {}
        if 'bbox' in data:
            viewport_data['bbox'] = data['bbox']
        if 'corners' in data:
            viewport_data['corners'] = data['corners']
        if 'zoom' in data:
            viewport_data['zoom'] = data['zoom']

        def _sync():
            table = Table.objects.filter(name=table_name).first()
            if not table:
                return

            state, _ = OTEFViewportState.objects.get_or_create(
                table=table,
                defaults={
                    'viewport': OTEFViewportState.DEFAULT_VIEWPORT.copy(),
                    'layers': OTEFViewportState.DEFAULT_LAYERS.copy(),
                    'animations': {'parcels': False}
                }
            )

            # Merge with existing viewport
            current = state.viewport or {}
            state.viewport = {**current, **viewport_data}
            state.save()

        await sync_to_async(_sync)()
        # Include the viewport data in the broadcast to eliminate HTTP GET round-trip
        await self._broadcast_change(table_name, 'viewport', data.get('viewport', viewport_data))

    async def _save_layers(self, table_name, layers):
        """Save layers to DB and broadcast notification"""
        from backend.models import OTEFViewportState, Table

        def _sync():
            table = Table.objects.filter(name=table_name).first()
            if not table:
                return

            state, _ = OTEFViewportState.objects.get_or_create(
                table=table,
                defaults={
                    'viewport': OTEFViewportState.DEFAULT_VIEWPORT.copy(),
                    'layers': OTEFViewportState.DEFAULT_LAYERS.copy(),
                    'animations': {'parcels': False}
                }
            )
            state.layers = layers
            state.save()

        await sync_to_async(_sync)()
        await self._broadcast_change(table_name, 'layers')

    async def _save_animation(self, table_name, layer_id, enabled):
        """Save animation state to DB and broadcast notification"""
        from backend.models import OTEFViewportState, Table

        def _sync():
            table = Table.objects.filter(name=table_name).first()
            if not table:
                return

            state, _ = OTEFViewportState.objects.get_or_create(
                table=table,
                defaults={
                    'viewport': OTEFViewportState.DEFAULT_VIEWPORT.copy(),
                    'layers': OTEFViewportState.DEFAULT_LAYERS.copy(),
                    'animations': {'parcels': False}
                }
            )
            animations = state.animations or {}
            animations[layer_id] = enabled
            state.animations = animations
            state.save()

        await sync_to_async(_sync)()

        # For animation, include state in notification for immediate update
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'broadcast_message',
                'message': {
                    'type': 'otef_animation_changed',
                    'table': table_name,
                    'layerId': layer_id,
                    'enabled': enabled
                }
            }
        )

    async def _broadcast_change(self, table_name, field, data=None):
        """Broadcast a state change notification"""
        message = {
            'type': f'otef_{field}_changed',
            'table': table_name,
            'sourceId': data.get('sourceId') if isinstance(data, dict) else None,
            'timestamp': data.get('timestamp') if isinstance(data, dict) else None
        }
        if data:
            if isinstance(data, dict) and field in data:
                 message[field] = data[field]
            else:
                 message[field] = data

        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'broadcast_message', 'message': message}
        )

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
