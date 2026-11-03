"""Ephemeral, targeted control of the workstation's browser projection windows."""
import asyncio
import hashlib
import json
import math
import re

_UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
_PREFIX = 'otef_output_'
_SCHEMAS = {
    'subscribe': {'sourceId'}, 'query': {'sourceId', 'queryId'},
    'register': {'hostId', 'connectionId'},
    'state': {'hostId', 'connectionId', 'sequence', 'queryId', 'state'},
    'command': {'sourceId', 'requestId', 'hostId', 'connectionId', 'action', 'value'},
    'ack': {'sourceId', 'requestId', 'hostId', 'connectionId', 'sequence', 'success', 'error', 'state'},
}


def _id(value):
    return isinstance(value, str) and bool(_UUID.fullmatch(value))


def _string(value, limit=500):
    return isinstance(value, str) and len(value) <= limit


def _state(value):
    fields = {'supported', 'screens', 'assignments', 'resolutions', 'reverseModel', 'ownedSpans', 'error', 'message'}
    if not isinstance(value, dict) or set(value) != fields or value['supported'] is not True:
        return False
    if type(value['reverseModel']) is not bool or not all(_string(value[key]) for key in ('error', 'message')):
        return False
    if not isinstance(value['screens'], list) or len(value['screens']) > 16:
        return False
    for screen in value['screens']:
        fields = {'key', 'label', 'left', 'top', 'width', 'height', 'availLeft', 'availTop', 'availWidth', 'availHeight', 'displayNumber'}
        if not isinstance(screen, dict) or set(screen) != fields or not _string(screen['key'], 1024) or not _string(screen['label']):
            return False
        if any(type(screen[key]) not in (int, float) or not math.isfinite(screen[key]) or abs(screen[key]) > 1000000
               for key in fields - {'key', 'label'}):
            return False
        if screen['width'] <= 0 or screen['height'] <= 0 or type(screen['displayNumber']) is not int:
            return False
    if not isinstance(value['ownedSpans'], list) or len(value['ownedSpans']) > 2 or any(side not in ('left', 'right') for side in value['ownedSpans']):
        return False
    assignments, resolutions = value['assignments'], value['resolutions']
    if not isinstance(assignments, dict) or set(assignments) - {'left', 'right'}:
        return False
    for assignment in assignments.values():
        if assignment is None:
            continue
        if not isinstance(assignment, dict) or set(assignment) != {'label', 'bounds'} or not _string(assignment['label']):
            return False
        bounds = assignment['bounds']
        if not isinstance(bounds, dict) or set(bounds) != {'left', 'top', 'width', 'height'}:
            return False
        if any(type(number) not in (int, float) or not math.isfinite(number) or abs(number) > 1000000 for number in bounds.values()):
            return False
    return isinstance(resolutions, dict) and not set(resolutions) - {'left', 'right'} and all(item in ('1080p', '4k') for item in resolutions.values())


def validate_output_message(value):
    if not isinstance(value, dict) or value.get('table') != 'otef' or not isinstance(value.get('type'), str):
        return None
    kind = value['type'].removeprefix(_PREFIX)
    fields = _SCHEMAS.get(kind)
    if not value['type'].startswith(_PREFIX) or fields is None or set(value) != fields | {'type', 'table'}:
        return None
    try:
        if len(json.dumps(value, ensure_ascii=False).encode('utf8')) > 32768:
            return None
    except (ValueError, TypeError, UnicodeEncodeError):
        return None
    if any(not _id(value[key]) for key in fields & {'sourceId', 'requestId', 'hostId', 'connectionId'}):
        return None
    if 'queryId' in fields and not (kind == 'state' and value['queryId'] is None) and not _id(value['queryId']):
        return None
    if 'sequence' in fields and (type(value['sequence']) is not int or not 0 < value['sequence'] <= 9007199254740991):
        return None
    if 'state' in fields and not _state(value['state']):
        return None
    if kind == 'ack' and not (type(value['success']) is bool and
                             ((value['success'] and value['error'] is None) or
                              (not value['success'] and _string(value['error']) and value['error']))):
        return None
    if kind == 'command':
        action, payload = value['action'], value['value']
        if not isinstance(action, str):
            return None
        if action in ('refresh', 'identify', 'open', 'close'):
            if payload is not None:
                return None
        elif action == 'reverse-model':
            if type(payload) is not bool:
                return None
        elif action == 'resolution':
            if not isinstance(payload, dict) or set(payload) != {'side', 'resolution'} or payload['side'] not in ('left', 'right') or payload['resolution'] not in ('1080p', '4k'):
                return None
        elif action == 'assign':
            if not isinstance(payload, dict) or set(payload) != {'left', 'right'} or not all(_string(key, 1024) and key for key in payload.values()) or payload['left'] == payload['right']:
                return None
        else:
            return None
    return dict(value)


def _target(host, connection):
    return 'projection_output_host_' + hashlib.sha256(f'{host}:{connection}'.encode('ascii')).hexdigest()


async def _join(consumer, group):
    groups = getattr(consumer, '_projection_output_groups', set())
    await consumer.channel_layer.group_add(group, consumer.channel_name)
    groups.add(group)
    consumer._projection_output_groups = groups


async def _send(consumer, group, message):
    await consumer.channel_layer.group_send(group, {'type': 'projection_output_event', 'message': message})


async def handle_projection_output_control(consumer, data):
    kind = data.get('type') if isinstance(data, dict) else None
    if not isinstance(kind, str) or not kind.startswith(_PREFIX):
        return False
    if getattr(consumer, 'channel_type', None) != 'otef' or getattr(consumer, 'room_group_name', None) != 'otef_channel':
        return True
    value = validate_output_message(data)
    if value is None:
        return True
    kind = kind[len(_PREFIX):]
    source = getattr(consumer, '_projection_output_source', None)
    identity = getattr(consumer, '_projection_output_identity', None)
    if kind == 'subscribe':
        if identity or source not in (None, value['sourceId']):
            return True
        consumer._projection_output_source = value['sourceId']
        await _join(consumer, 'projection_output_observer_' + value['sourceId'])
        await _join(consumer, 'projection_output_observers')
    elif kind == 'register':
        new_identity = (value['hostId'], value['connectionId'])
        if source or identity not in (None, new_identity):
            return True
        consumer._projection_output_identity = new_identity
        await _join(consumer, 'projection_output_hosts')
        await _join(consumer, _target(*new_identity))
        if identity is None:
            await _send(consumer, 'projection_output_observers', {'type': _PREFIX + 'hosts_changed', 'table': 'otef'})
    elif kind in ('query', 'command'):
        if source != value['sourceId']:
            return True
        await _send(consumer, 'projection_output_hosts' if kind == 'query' else _target(value['hostId'], value['connectionId']), value)
    elif kind in ('state', 'ack'):
        if identity != (value['hostId'], value['connectionId']):
            return True
        if value['sequence'] <= getattr(consumer, '_projection_output_sequence', 0):
            return True
        consumer._projection_output_sequence = value['sequence']
        await _send(consumer, 'projection_output_observers' if kind == 'state' else 'projection_output_observer_' + value['sourceId'], value)
    return True


async def disconnect_projection_output_control(consumer):
    identity = getattr(consumer, '_projection_output_identity', None)
    try:
        if identity:
            await _send(consumer, 'projection_output_observers', {'type': _PREFIX + 'disconnected', 'table': 'otef', 'hostId': identity[0], 'connectionId': identity[1]})
    except Exception:
        pass
    finally:
        await asyncio.gather(*(consumer.channel_layer.group_discard(group, consumer.channel_name)
                               for group in getattr(consumer, '_projection_output_groups', set())), return_exceptions=True)
        consumer._projection_output_groups = set()
