from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

from .consumers import GeneralConsumer


class NliVideoPlaybackRelayTests(IsolatedAsyncioTestCase):
    def consumer(self):
        consumer = GeneralConsumer()
        consumer.channel_type = 'otef'
        consumer.room_group_name = 'otef_channel'
        consumer.channel_layer = type('Layer', (), {'group_send': AsyncMock()})()
        consumer._save_viewport = AsyncMock()
        consumer._save_layers = AsyncMock()
        return consumer

    async def test_exact_state_and_query_relay_without_persistence(self):
        consumer = self.consumer()
        messages = [
            {'type': 'otef_nli_video_playback_state', 'table': 'otef', 'sourceId': 'gis', 'sequence': 1, 'active': True},
            {'type': 'otef_nli_video_playback_state', 'table': 'otef', 'sourceId': 'gis', 'sequence': 2, 'active': False},
            {'type': 'otef_nli_video_playback_query', 'table': 'otef', 'requesterId': 'output'},
        ]
        for message in messages:
            await consumer.handle_otef_message(message)
        self.assertEqual([call.args[1]['message'] for call in consumer.channel_layer.group_send.await_args_list], messages)
        consumer._save_viewport.assert_not_awaited()
        consumer._save_layers.assert_not_awaited()

    async def test_malformed_and_cross_room_payloads_are_dropped(self):
        consumer = self.consumer()
        state = {'type': 'otef_nli_video_playback_state', 'table': 'otef', 'sourceId': 'gis', 'sequence': 1, 'active': True}
        invalid = [{'extra': 1}, {'table': 'other'}, {'sequence': True}, {'sequence': 0}, {'sequence': -1},
                   {'sequence': 9007199254740992}, {'sequence': 1.5}, {'active': 1}, {'sourceId': ''},
                   {'sourceId': []}, {'sourceId': 'x' * 129}]
        for changes in invalid:
            await consumer.handle_otef_message({**state, **changes})
        query = {'type': 'otef_nli_video_playback_query', 'table': 'otef', 'requesterId': 'output'}
        for changes in ({'extra': 1}, {'requesterId': ''}, {'requesterId': []}, {'requesterId': 'x' * 129}, {'table': 'other'}):
            await consumer.handle_otef_message({**query, **changes})
        consumer.channel_layer.group_send.assert_not_awaited()
