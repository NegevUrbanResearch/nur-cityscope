from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

from .consumers import GeneralConsumer


class ProjectionTransientRelayTests(IsolatedAsyncioTestCase):
    async def test_pattern_and_status_are_relayed_without_database_writes(self):
        consumer = GeneralConsumer()
        consumer.room_group_name = "otef_channel"
        consumer.channel_layer = type("Layer", (), {"group_send": AsyncMock()})()
        valid_uuid = "11111111-1111-4111-8111-111111111111"
        for message in (
            {"type": "otef_projection_pattern", "table": "otef", "output": "left", "pattern": "grid", "sourceId": valid_uuid},
            {"type": "otef_projection_status_request", "table": "otef", "sourceId": valid_uuid},
            {"type": "otef_projection_applied", "table": "otef", "output": "left", "revision": 2, "instanceId": valid_uuid, "success": True},
        ):
            await consumer.handle_otef_message(message)
        self.assertEqual(consumer.channel_layer.group_send.await_count, 3)

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
