from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

from .consumers import GeneralConsumer


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
