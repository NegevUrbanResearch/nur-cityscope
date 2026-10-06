from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

from .consumers import GeneralConsumer


def cursor_fixture(**overrides):
    return {'type': 'otef_projection_match_cursor', 'table': 'otef', 'output': 'left',
            'instanceId': '11111111-1111-4111-8111-111111111111',
            'sourceId': '22222222-2222-4222-8222-222222222222',
            'sessionId': '33333333-3333-4333-8333-333333333333',
            'sequence': 1, 'revision': 12, 'sourceFrameIdentity': 'frame',
            'mode': 'cursor', 'pointId': 1, 'targetPx': [410, 295], 'sourcePx': [390, 310], **overrides}


def ack_fixture(**overrides):
    return {'type': 'otef_projection_match_ack', 'table': 'otef', 'output': 'left',
            'instanceId': '11111111-1111-4111-8111-111111111111',
            'sourceId': '22222222-2222-4222-8222-222222222222',
            'sessionId': '33333333-3333-4333-8333-333333333333',
            'sequence': 1, 'revision': 12, 'sourceFrameIdentity': 'frame',
            'displaySide': 'left', 'reversed': False, 'success': True, 'error': None, **overrides}


class ProjectionTransientRelayTests(IsolatedAsyncioTestCase):
    async def test_optional_cursor_radius_bounds_and_legacy_payloads(self):
        consumer = GeneralConsumer()
        consumer.room_group_name = 'otef_channel'
        consumer.channel_layer = type('Layer', (), {'group_send': AsyncMock()})()
        messages = [cursor_fixture(), *(cursor_fixture(markerRadiusPx=n) for n in (4, 8, 15, 4.5))]
        for message in messages:
            await consumer.handle_otef_message(message)
        self.assertEqual([call.args[1]['message'] for call in consumer.channel_layer.group_send.await_args_list], messages)
        consumer.channel_layer.group_send.reset_mock()
        invalid = [cursor_fixture(markerRadiusPx=n) for n in (3.99, 15.01, True, False, float('nan'), float('inf'), -float('inf'), '8', None, [], {})]
        invalid += [cursor_fixture(mode=mode, pointId=0, targetPx=None, sourcePx=None, markerRadiusPx=8) for mode in ('probe', 'off')]
        invalid += [cursor_fixture(markerRadiusPx=8, extra=True), ack_fixture(markerRadiusPx=8)]
        for message in invalid:
            await consumer.handle_otef_message(message)
        consumer.channel_layer.group_send.assert_not_awaited()

    async def test_calibration_exact_protocol_relay(self):
        consumer = GeneralConsumer()
        consumer.room_group_name = 'otef_channel'
        consumer.channel_layer = type('Layer', (), {'group_send': AsyncMock()})()
        common = {key: cursor_fixture()[key] for key in ('table', 'output', 'instanceId', 'sourceId', 'sessionId', 'sequence')}
        command = {**common, 'type': 'otef_projection_calibration_view', 'mode': 'landmarks', 'blackout': True}
        ack = {**common, 'type': 'otef_projection_calibration_view_ack', 'displaySide': 'right', 'reversed': True,
               'sceneIdentity': None, 'ready': False, 'missingIds': [], 'blackout': True, 'success': True, 'error': None}
        for message in (command, ack, {**command, 'mode': 'off', 'blackout': False}):
            await consumer.handle_otef_message(message)
        self.assertEqual(consumer.channel_layer.group_send.await_count, 3)
        consumer.channel_layer.group_send.reset_mock()
        for base in (command, ack):
            for changes in ({'extra': True}, {'sequence': True}, {'sequence': -1}, {'instanceId': 'invalid'}, {'blackout': 1}, {'output': []}):
                await consumer.handle_otef_message({**base, **changes})
        for changes in ({'sceneIdentity': 'x' * 4097}, {'sceneIdentity': 'premature'}, {'missingIds': ['x'] * 8}, {'missingIds': [True]}, {'ready': True}, {'error': 'bad'}):
            await consumer.handle_otef_message({**ack, **changes})
        await consumer.handle_otef_message({**command, 'mode': 'off'})
        consumer.channel_layer.group_send.assert_not_awaited()

    async def test_match_cursor_and_ack_relay_without_persistence(self):
        consumer = GeneralConsumer()
        consumer.room_group_name = 'otef_channel'
        consumer.channel_layer = type('Layer', (), {'group_send': AsyncMock()})()
        messages = [cursor_fixture(), ack_fixture(), cursor_fixture(mode='probe', pointId=0, targetPx=None, sourcePx=None),
                    cursor_fixture(mode='off', pointId=0, targetPx=None, sourcePx=None), ack_fixture(success=False, error='not ready')]
        for message in messages:
            await consumer.handle_otef_message(message)
        self.assertEqual([call.args[1]['message'] for call in consumer.channel_layer.group_send.await_args_list], messages)

    async def test_match_contract_rejects_malformed_and_extra_fields(self):
        consumer = GeneralConsumer()
        consumer.room_group_name = 'otef_channel'
        consumer.channel_layer = type('Layer', (), {'group_send': AsyncMock()})()
        changes = [{'extra': True}, {'sequence': True}, {'revision': False}, {'sequence': -1}, {'revision': 9007199254740992},
                   {'sourceId': 'invalid'}, {'instanceId': []}, {'sessionId': None}, {'output': []},
                   {'sourceFrameIdentity': 'x' * 4097}, {'sourceFrameIdentity': ''}]
        invalid = [factory(**change) for factory in (cursor_fixture, ack_fixture) for change in changes]
        invalid += [cursor_fixture(**change) for change in [
            {'targetPx': [float('nan'), 1]}, {'targetPx': [1, float('inf')]}, {'sourcePx': [1921, 1]},
            {'sourcePx': [-1, 1]}, {'targetPx': [1, 1081]}, {'targetPx': [True, 1]}, {'targetPx': [1, 2, 3]},
            {'pointId': True}, {'pointId': 0}, {'mode': 'probe'}, {'mode': 'off', 'pointId': 0}]]
        invalid += [ack_fixture(**change) for change in [{'displaySide': []}, {'reversed': 1}, {'success': 1},
            {'error': 'bad'}, {'success': False, 'error': None}, {'success': False, 'error': 'x' * 241}]]
        for message in invalid:
            await consumer.handle_otef_message(message)
        consumer.channel_layer.group_send.assert_not_awaited()

    async def test_applied_relay_preserves_actual_display_launch_metadata(self):
        consumer = GeneralConsumer()
        consumer.room_group_name = 'otef_channel'
        consumer.channel_layer = type('Layer', (), {'group_send': AsyncMock()})()
        message = {'type': 'otef_projection_applied', 'table': 'otef', 'output': 'right', 'revision': 12,
                   'instanceId': cursor_fixture()['instanceId'], 'success': True, 'displaySide': 'left', 'reversed': True}
        await consumer.handle_otef_message(message)
        self.assertEqual(consumer.channel_layer.group_send.await_args.args[1]['message'], message)
        for change in [{'displaySide': []}, {'reversed': 1}]:
            await consumer.handle_otef_message({**message, **change})
        self.assertEqual(consumer.channel_layer.group_send.await_count, 1)
    async def test_names_run_and_status_relay_exact_ephemeral_payloads(self):
        consumer = GeneralConsumer()
        consumer.room_group_name = "otef_channel"
        consumer.channel_layer = type("Layer", (), {"group_send": AsyncMock()})()
        request_id = "33333333-3333-4333-8333-333333333333"
        instance_id = "11111111-1111-4111-8111-111111111111"
        run = {"type": "otef_projection_names_run", "table": "otef", "requestId": request_id,
               "revision": 7, "datasetVersion": "release-v1", "placementIdentity": "a" * 64}
        status = {"type": "otef_projection_names_status", "table": "otef", "output": "left",
                  "instanceId": instance_id, "requestId": request_id, "revision": 7,
                  "datasetVersion": "release-v1", "placementIdentity": "a" * 64,
                  "state": "current", "installed": {"revision": 7, "datasetVersion": "release-v1",
                  "placementIdentity": "a" * 64, "mode": "wall", "digest": "b" * 64,
                  "expected": 1228, "placed": 1228}}
        await consumer.handle_otef_message(run)
        await consumer.handle_otef_message(status)
        relayed = [call.args[1]["message"] for call in consumer.channel_layer.group_send.await_args_list]
        self.assertEqual(relayed, [run, status])

    async def test_names_transient_messages_reject_extra_or_malformed_fields(self):
        consumer = GeneralConsumer()
        consumer.room_group_name = "otef_channel"
        consumer.channel_layer = type("Layer", (), {"group_send": AsyncMock()})()
        base_run = {"type": "otef_projection_names_run", "table": "otef",
                    "requestId": "33333333-3333-4333-8333-333333333333", "revision": 7,
                    "datasetVersion": "release-v1", "placementIdentity": "a" * 64}
        base_status = {"type": "otef_projection_names_status", "table": "otef", "output": "left",
                       "instanceId": "11111111-1111-4111-8111-111111111111", "requestId": None,
                       "revision": 7, "datasetVersion": "release-v1", "placementIdentity": "a" * 64,
                       "state": "stale", "installed": None}
        invalid = [
            {**base_run, "extra": "x"}, {**base_run, "revision": True},
            {**base_run, "placementIdentity": "short"}, {**base_run, "requestId": "invalid"},
            {**base_status, "extra": "x"}, {**base_status, "state": "unknown"},
            {**base_status, "installed": {"digest": "x"}},
        ]
        for message in invalid:
            await consumer.handle_otef_message(message)
        consumer.channel_layer.group_send.assert_not_awaited()

    async def test_pattern_and_status_are_relayed_without_database_writes(self):
        consumer = GeneralConsumer()
        consumer.room_group_name = "otef_channel"
        consumer.channel_layer = type("Layer", (), {"group_send": AsyncMock()})()
        valid_uuid = "11111111-1111-4111-8111-111111111111"
        for message in (
            {"type": "otef_projection_pattern", "table": "otef", "output": "left", "pattern": "grid", "sourceId": valid_uuid},
            {"type": "otef_projection_status_request", "table": "otef", "sourceId": valid_uuid},
            {"type": "otef_projection_applied", "table": "otef", "output": "left", "revision": 2, "instanceId": valid_uuid, "success": True},
            {"type": "otef_projection_applied", "table": "otef", "output": "left", "revision": 3, "instanceId": valid_uuid, "success": True, "route": "browser", "baseline": {"type": "identity"}},
            {"type": "otef_projection_applied", "table": "otef", "output": "right", "revision": 4, "instanceId": valid_uuid, "success": True, "route": "browser", "baseline": {"type": "tdMesh", "assetId": "fixture-right", "sha256": "a" * 64}},
            {"type": "otef_projection_applied", "table": "otef", "output": "right", "revision": 4, "instanceId": valid_uuid, "success": False, "error": "mesh unavailable", "route": "browser", "baseline": {"type": "tdMesh", "assetId": "fixture-right", "sha256": "SHA256:" + "a" * 64}},
        ):
            await consumer.handle_otef_message(message)
        self.assertEqual(consumer.channel_layer.group_send.await_count, 6)
        relayed = [call.args[1]["message"] for call in consumer.channel_layer.group_send.await_args_list]
        self.assertEqual(relayed[-1]["success"], False)
        self.assertEqual(relayed[-1]["route"], "browser")
        self.assertEqual(relayed[-2]["success"], True)
        self.assertEqual(relayed[-2]["baseline"]["type"], "tdMesh")
        self.assertEqual(relayed[-1]["baseline"]["sha256"], "SHA256:" + "a" * 64)

    async def test_invalid_projection_transient_payload_is_dropped(self):
        consumer = GeneralConsumer()
        consumer.room_group_name = "otef_channel"
        consumer.channel_layer = type("Layer", (), {"group_send": AsyncMock()})()
        await consumer.handle_otef_message({
            "type": "otef_projection_pattern", "table": "otef", "output": "left", "pattern": "blackout",
            "sourceId": "not-a-uuid",
        })
        consumer.channel_layer.group_send.assert_not_awaited()

    async def test_transient_validator_rejects_collections_extras_and_unsafe_revisions(self):
        consumer = GeneralConsumer()
        consumer.room_group_name = "otef_channel"
        consumer.channel_layer = type("Layer", (), {"group_send": AsyncMock()})()
        valid_uuid = "11111111-1111-4111-8111-111111111111"
        invalid = [
            {"type": "otef_projection_pattern", "table": "otef", "output": [], "pattern": "grid", "sourceId": valid_uuid},
            {"type": "otef_projection_status_request", "table": "otef", "sourceId": valid_uuid, "extra": "x"},
            {"type": "otef_projection_applied", "table": "otef", "output": "left", "revision": 9007199254740992, "instanceId": valid_uuid, "success": True},
        ]
        for message in invalid:
            await consumer.handle_otef_message(message)
        consumer.channel_layer.group_send.assert_not_awaited()

    async def test_projection_ack_rejects_malformed_route_and_baseline_metadata(self):
        consumer = GeneralConsumer()
        consumer.room_group_name = "otef_channel"
        consumer.channel_layer = type("Layer", (), {"group_send": AsyncMock()})()
        valid_uuid = "11111111-1111-4111-8111-111111111111"
        invalid = [
            {"type": "otef_projection_applied", "table": "otef", "output": "left", "revision": 1, "instanceId": valid_uuid, "success": True, "route": "unknown"},
            {"type": "otef_projection_applied", "table": "otef", "output": "left", "revision": 1, "instanceId": valid_uuid, "success": True, "route": "browser", "baseline": {"type": "identity", "extra": True}},
            {"type": "otef_projection_applied", "table": "otef", "output": "left", "revision": 1, "instanceId": valid_uuid, "success": True, "route": "browser", "baseline": {"type": "tdMesh", "assetId": "fixture", "sha256": "not-a-hash"}},
            {"type": "otef_projection_applied", "table": "otef", "output": "left", "revision": 1, "instanceId": valid_uuid, "success": True, "route": "browser", "baseline": {"type": "tdMesh", "assetId": "fixture", "sha256": "a" * 64, "width": 1920}},
        ]
        for message in invalid:
            await consumer.handle_otef_message(message)
        consumer.channel_layer.group_send.assert_not_awaited()

    async def test_wall_ack_relays_only_bounded_exact_diagnostics(self):
        consumer = GeneralConsumer()
        consumer.room_group_name = 'otef_channel'
        consumer.channel_layer = type('Layer', (), {'group_send': AsyncMock()})()
        base = {'type': 'otef_projection_applied', 'table': 'otef', 'output': 'left', 'revision': 8,
                'instanceId': '11111111-1111-4111-8111-111111111111', 'success': True}
        wall = {'datasetVersion': 'nli-release', 'mode': 'wall', 'digest': 'a' * 64, 'expected': 1228, 'placed': 1228}
        await consumer.handle_otef_message({**base, 'wall': wall})
        self.assertEqual(consumer.channel_layer.group_send.await_args.args[1]['message']['wall'], wall)
        for bad in ({**wall, 'placed': 1229}, {**wall, 'expected': True}, {**wall, 'digest': 'short'},
                    {**wall, 'extra': 1}, {**wall, 'datasetVersion': 'x' * 129}):
            await consumer.handle_otef_message({**base, 'wall': bad})
        self.assertEqual(consumer.channel_layer.group_send.await_count, 1)


class TransientViewportRelayTests(IsolatedAsyncioTestCase):
    async def test_transient_viewport_is_broadcast_without_database_save(self):
        consumer = GeneralConsumer()
        consumer._save_viewport = AsyncMock()
        consumer._broadcast_change = AsyncMock()
        message = {
            "type": "otef_viewport_update",
            "table": "otef",
            "viewport": {"bbox": [1, 2, 3, 4], "zoom": 15, "timestamp": 300},
            "sourceId": "gis-client",
            "timestamp": 300,
            "traceId": "place-nav-test",
            "transient": True,
        }

        await consumer.handle_otef_message(message)

        consumer._save_viewport.assert_not_awaited()
        consumer._broadcast_change.assert_awaited_once_with("otef", "viewport", message)


class SettlementNameRelayTests(IsolatedAsyncioTestCase):
    async def test_client_cannot_broadcast_saved_settlement_settings(self):
        consumer = GeneralConsumer()
        consumer.room_group_name = 'otef_channel'
        consumer.channel_layer = type('Layer', (), {'group_send': AsyncMock()})()
        await consumer.handle_otef_message({
            'type': 'otef_settlement_names_changed', 'table': 'otef',
            'sourceId': '11111111-1111-4111-8111-111111111111',
            'settlementNameSettings': {}, 'settlementNameRevision': 1,
        })
        consumer.channel_layer.group_send.assert_not_awaited()
