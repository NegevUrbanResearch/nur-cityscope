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
import re
import uuid
import math


_PROJECTION_OUTPUTS = {"left", "right"}
_PROJECTION_PATTERNS = {"off", "grid", "output_id"}
_PROJECTION_ROUTES = {"browser", "maplibre", "td"}
_PROJECTION_NAMES_STATES = {"initializing", "stale", "rebuilding", "failed", "current"}
_PROJECTION_SHA256 = re.compile(r"^(?:sha256:)?[0-9a-f]{64}$", re.IGNORECASE)


def _valid_uuid(value):
    if not isinstance(value, str) or len(value) > 64:
        return False
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return str(parsed) == value.lower()


def _valid_projection_baseline(value):
    if not isinstance(value, dict):
        return False
    baseline_type = value.get("type")
    if baseline_type == "identity":
        return set(value) == {"type"}
    if baseline_type != "tdMesh" or set(value) != {"type", "assetId", "sha256"}:
        return False
    asset_id = value.get("assetId")
    digest = value.get("sha256")
    return isinstance(asset_id, str) and 0 < len(asset_id) <= 128 and isinstance(digest, str) and bool(_PROJECTION_SHA256.fullmatch(digest))


def _valid_projection_wall(value):
    if not isinstance(value, dict) or set(value) != {'datasetVersion', 'mode', 'digest', 'expected', 'placed'}:
        return False
    version = value['datasetVersion']
    if not isinstance(version, str) or not 0 < len(version) <= 128:
        return False
    if value['mode'] not in ('wall', 'model') or not isinstance(value['digest'], str) or not re.fullmatch(r'[0-9a-f]{64}', value['digest'], re.IGNORECASE):
        return False
    expected, placed = value['expected'], value['placed']
    return type(expected) is int and type(placed) is int and 0 < expected <= 100000 and 0 <= placed <= expected


def _valid_projection_names_run(data):
    if set(data) != {"type", "table", "requestId", "revision", "datasetVersion", "placementIdentity"}:
        return None
    if not _valid_uuid(data.get("requestId")):
        return None
    revision = data.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0 or revision > 9007199254740991:
        return None
    dataset_version = data.get("datasetVersion")
    identity = data.get("placementIdentity")
    if not isinstance(dataset_version, str) or not 0 < len(dataset_version) <= 128:
        return None
    if not isinstance(identity, str) or not re.fullmatch(r"[0-9a-f]{64}", identity, re.IGNORECASE):
        return None
    return {key: data[key] for key in ("type", "table", "requestId", "revision", "datasetVersion", "placementIdentity")}


def _valid_projection_names_status(data):
    allowed = {"type", "table", "output", "instanceId", "requestId", "revision", "datasetVersion",
               "placementIdentity", "state", "installed", "error"}
    required = allowed - {"error"}
    if set(data) - allowed or not required.issubset(data):
        return None
    if data.get("output") not in _PROJECTION_OUTPUTS or not _valid_uuid(data.get("instanceId")):
        return None
    if data.get("requestId") is not None and not _valid_uuid(data.get("requestId")):
        return None
    revision = data.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0 or revision > 9007199254740991:
        return None
    version = data.get("datasetVersion")
    identity = data.get("placementIdentity")
    if not isinstance(version, str) or len(version) > 128:
        return None
    if not isinstance(identity, str) or (identity and not re.fullmatch(r"[0-9a-f]{64}", identity, re.IGNORECASE)):
        return None
    if data.get("state") not in _PROJECTION_NAMES_STATES:
        return None
    if "error" in data and (not isinstance(data["error"], str) or not 0 < len(data["error"]) <= 240):
        return None
    installed = data.get("installed")
    if installed is not None:
        keys = {"revision", "datasetVersion", "placementIdentity", "mode", "digest", "expected", "placed"}
        if not isinstance(installed, dict) or set(installed) != keys:
            return None
        if (isinstance(installed.get("revision"), bool) or not isinstance(installed.get("revision"), int) or installed["revision"] < 0 or
            not isinstance(installed.get("datasetVersion"), str) or not 0 < len(installed["datasetVersion"]) <= 128 or
            not isinstance(installed.get("placementIdentity"), str) or not re.fullmatch(r"[0-9a-f]{64}", installed["placementIdentity"], re.IGNORECASE) or
            installed.get("mode") not in ("wall", "model") or not isinstance(installed.get("digest"), str) or not re.fullmatch(r"[0-9a-f]{64}", installed["digest"], re.IGNORECASE) or
            type(installed.get("expected")) is not int or type(installed.get("placed")) is not int or
            not 0 < installed["expected"] <= 100000 or installed["placed"] != installed["expected"]):
            return None
    return {key: data[key] for key in data}


def _valid_projection_match(data):
    common = {'type', 'table', 'output', 'instanceId', 'sourceId', 'sessionId', 'sequence', 'revision', 'sourceFrameIdentity'}
    command = data['type'] == 'otef_projection_match_cursor'
    extra = {'mode', 'pointId', 'targetPx', 'sourcePx'} if command else {'displaySide', 'reversed', 'success', 'error'}
    if set(data) != common | extra:
        return None
    if not isinstance(data['output'], str) or data['output'] not in _PROJECTION_OUTPUTS:
        return None
    if not all(_valid_uuid(data[key]) for key in ('instanceId', 'sourceId', 'sessionId')):
        return None
    if not all(type(data[key]) is int and 0 <= data[key] <= 9007199254740991 for key in ('sequence', 'revision')):
        return None
    identity = data['sourceFrameIdentity']
    if not isinstance(identity, str) or not 0 < len(identity) <= 4096:
        return None
    if command:
        if data['mode'] in ('probe', 'off'):
            if type(data['pointId']) is not int or data['pointId'] != 0 or data['targetPx'] is not None or data['sourcePx'] is not None:
                return None
        elif data['mode'] == 'cursor':
            if type(data['pointId']) is not int or not 1 <= data['pointId'] <= 6:
                return None
            for key in ('targetPx', 'sourcePx'):
                pair = data[key]
                if not isinstance(pair, list) or len(pair) != 2:
                    return None
                if not all(type(n) in (int, float) and 0 <= n <= limit and math.isfinite(n) for n, limit in zip(pair, (1920, 1080))):
                    return None
        else:
            return None
    else:
        if not isinstance(data['displaySide'], str) or data['displaySide'] not in _PROJECTION_OUTPUTS or type(data['reversed']) is not bool or type(data['success']) is not bool:
            return None
        if data['success']:
            if data['error'] is not None:
                return None
        elif not isinstance(data['error'], str) or len(data['error']) > 240:
            return None
    return dict(data)


def _valid_projection_transient(data):
    if not isinstance(data, dict) or data.get("table") != "otef":
        return None
    message_type = data.get("type")
    if message_type in ('otef_projection_match_cursor', 'otef_projection_match_ack'):
        return _valid_projection_match(data)
    if message_type == "otef_projection_pattern":
        if set(data) != {"type", "table", "output", "pattern", "sourceId"}:
            return None
        if not isinstance(data.get("output"), str) or data["output"] not in _PROJECTION_OUTPUTS:
            return None
        if not isinstance(data.get("pattern"), str) or data["pattern"] not in _PROJECTION_PATTERNS:
            return None
        if not _valid_uuid(data.get("sourceId")):
            return None
        return {key: data[key] for key in ("type", "table", "output", "pattern", "sourceId")}
    if message_type == "otef_projection_status_request":
        if set(data) != {"type", "table", "sourceId"} or not _valid_uuid(data.get("sourceId")):
            return None
        return {key: data[key] for key in ("type", "table", "sourceId")}
    if message_type == "otef_projection_names_run":
        return _valid_projection_names_run(data)
    if message_type == "otef_projection_names_status":
        return _valid_projection_names_status(data)
    if message_type == "otef_projection_applied":
        allowed = {"type", "table", "output", "revision", "instanceId", "success", "error", "route", "baseline", "wall", "displaySide", "reversed"}
        if set(data) - allowed or not {"type", "table", "output", "revision", "instanceId", "success"}.issubset(data):
            return None
        if not isinstance(data.get("output"), str) or data["output"] not in _PROJECTION_OUTPUTS:
            return None
        revision = data.get("revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0 or revision > 9007199254740991:
            return None
        if not _valid_uuid(data.get("instanceId")) or not isinstance(data.get("success"), bool):
            return None
        if "error" in data and (not isinstance(data["error"], str) or not 0 < len(data["error"]) <= 240):
            return None
        if "route" in data and data["route"] not in _PROJECTION_ROUTES:
            return None
        if "baseline" in data and not _valid_projection_baseline(data["baseline"]):
            return None
        if "wall" in data and not _valid_projection_wall(data["wall"]):
            return None
        if 'displaySide' in data and (not isinstance(data['displaySide'], str) or data['displaySide'] not in _PROJECTION_OUTPUTS):
            return None
        if 'reversed' in data and type(data['reversed']) is not bool:
            return None
        payload = {key: data[key] for key in ("type", "table", "output", "revision", "instanceId", "success")}
        if "error" in data:
            payload["error"] = data["error"]
        if "route" in data:
            payload["route"] = data["route"]
        if "baseline" in data:
            payload["baseline"] = data["baseline"]
        if "wall" in data:
            payload["wall"] = data["wall"]
        for key in ('displaySide', 'reversed'):
            if key in data:
                payload[key] = data[key]
        return payload
    return None


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
            elif message_type.endswith('_changed'):
                return
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

        if message_type == 'otef_projection_trace':
            # Diagnostics are validated and ACKed to this socket only. Keep them
            # outside all state, calibration, and room-broadcast paths.
            from .projection_trace import handle_projection_trace
            await handle_projection_trace(self, data)

        elif message_type == 'otef_viewport_control':
            # Pan/zoom command - either execute server-side or forward to GIS
            action = data.get('action')

            if action == 'pan':
                await self._execute_pan_command(table_name, data)
            elif action == 'zoom':
                await self._execute_zoom_command(table_name, data)
            else:
                return

        elif message_type == 'otef_layer_update':
            # Layer visibility change
            await self._save_layers(table_name, data.get('layers', {}))

        elif message_type == 'otef_animation_toggle':
            # Animation state change
            await self._save_animation(table_name, data.get('layerId'), data.get('enabled', False))

        elif message_type == 'otef_viewport_update':
            # Search-travel frames are display-only. Relaying them without a
            # database write prevents a persistence backlog from replaying
            # after the GIS camera settles; its final idle frame uses PATCH.
            if data.get('transient') is True:
                await self._broadcast_change(table_name, 'viewport', data)
            else:
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

        elif message_type == 'otef_projection_config_changed':
            # Projection changes are emitted by the transactional service only.
            return

        elif message_type == 'otef_settlement_names_changed':
            # Settlement settings are emitted by the transactional service only.
            return

        elif message_type in {
            'otef_projection_pattern',
            'otef_projection_status_request',
            'otef_projection_applied',
            'otef_projection_names_run',
            'otef_projection_names_status',
            'otef_projection_match_cursor',
            'otef_projection_match_ack',
        }:
            # These are intentionally ephemeral. Validate at the socket boundary,
            # relay in memory, and never involve the calibration or viewport rows.
            payload = _valid_projection_transient(data)
            if payload is not None:
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {'type': 'broadcast_message', 'message': payload},
                )

        else:
            # State changes are server-originated; reject unknown OTEF inputs.
            return

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
                    'animations': {}
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
                    'animations': {}
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
                    'animations': {}
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
                    'animations': {}
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
                    'animations': {}
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
