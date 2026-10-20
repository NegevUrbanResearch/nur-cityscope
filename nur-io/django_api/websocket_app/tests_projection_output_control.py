from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock
from types import SimpleNamespace

from .projection_output_control import handle_projection_output_control, validate_output_message

HOST = '11111111-1111-4111-8111-111111111111'
CONNECTION = '22222222-2222-4222-8222-222222222222'
SOURCE = '33333333-3333-4333-8333-333333333333'
REQUEST = '44444444-4444-4444-8444-444444444444'


def consumer():
    value = SimpleNamespace()
    value.channel_type, value.room_group_name, value.channel_name = 'otef', 'otef_channel', 'test-channel'
    value.channel_layer = type('Layer', (), {'group_add': AsyncMock(), 'group_discard': AsyncMock(), 'group_send': AsyncMock()})()
    return value


def command(**changes):
    return {'type': 'otef_output_command', 'table': 'otef', 'sourceId': SOURCE, 'requestId': REQUEST,
            'hostId': HOST, 'connectionId': CONNECTION, 'action': 'open', 'value': None, **changes}


class ProjectionOutputControlTests(IsolatedAsyncioTestCase):
    def test_exact_command_shapes(self):
        self.assertIsNotNone(validate_output_message(command()))
        for value in [command(extra=1), command(action='eval'), command(value={}), command(hostId=[]),
                      command(action='assign', value={'left': 'same', 'right': 'same'}),
                      command(action='resolution', value={'side': 'left', 'resolution': '8k'})]:
            self.assertIsNone(validate_output_message(value))
        self.assertIsNotNone(validate_output_message(command(action='resolution', value={'side': 'left', 'resolution': '4k'})))

    async def test_commands_are_targeted_and_observer_identity_is_bound(self):
        observer = consumer()
        await handle_projection_output_control(observer, command())
        observer.channel_layer.group_send.assert_not_awaited()
        await handle_projection_output_control(observer, {'type': 'otef_output_subscribe', 'table': 'otef', 'sourceId': SOURCE})
        await handle_projection_output_control(observer, command())
        group = observer.channel_layer.group_send.call_args.args[0]
        self.assertTrue(group.startswith('projection_output_host_'))
        self.assertNotEqual(group, 'otef_channel')
        count = observer.channel_layer.group_send.await_count
        await handle_projection_output_control(observer, command(sourceId=REQUEST))
        self.assertEqual(observer.channel_layer.group_send.await_count, count)

    async def test_only_registered_host_can_send_receipts_and_cannot_switch_identity(self):
        host = consumer()
        ack = {'type': 'otef_output_ack', 'table': 'otef', 'hostId': HOST, 'connectionId': CONNECTION,
               'sourceId': SOURCE, 'requestId': REQUEST, 'sequence': 1, 'success': False,
               'error': 'Popup blocked', 'state': {'supported': True, 'screens': [], 'assignments': {},
               'resolutions': {}, 'reverseModel': False, 'ownedSpans': [], 'message': '', 'error': 'Popup blocked'}}
        await handle_projection_output_control(host, ack)
        host.channel_layer.group_send.assert_not_awaited()
        await handle_projection_output_control(host, {'type': 'otef_output_register', 'table': 'otef', 'hostId': HOST, 'connectionId': CONNECTION})
        await handle_projection_output_control(host, ack)
        self.assertEqual(host.channel_layer.group_send.call_args.args[0], 'projection_output_observer_' + SOURCE)
        count = host.channel_layer.group_send.await_count
        await handle_projection_output_control(host, {**ack, 'hostId': REQUEST, 'sequence': 2})
        self.assertEqual(host.channel_layer.group_send.await_count, count)

    async def test_other_rooms_cannot_route_output_actions(self):
        value = consumer(); value.channel_type = 'presentation'
        await handle_projection_output_control(value, {'type': 'otef_output_subscribe', 'table': 'otef', 'sourceId': SOURCE})
        value.channel_layer.group_add.assert_not_awaited()
