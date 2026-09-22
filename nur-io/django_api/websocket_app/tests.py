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
