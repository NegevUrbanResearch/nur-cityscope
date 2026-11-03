import json
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, Mock, patch

from .consumers import GeneralConsumer


SESSION = "22222222-2222-4222-8222-222222222222"
CLIENT = "11111111-1111-4111-8111-111111111111"


def valid_batch(**changes):
    batch = {
        "type": "otef_projection_trace", "table": "otef", "version": 1,
        "sessionId": SESSION, "clientId": CLIENT, "seq": 1, "dropped": 0,
        "events": [{"t": 12.5, "kind": "pointer", "detail": {
            "phase": "pointerdown", "pointerId": 3, "clientX": 20.0, "primary": True,
        }}],
    }
    batch.update(changes)
    return batch


class ProjectionTraceHandlerTests(IsolatedAsyncioTestCase):
    def make_consumer(self, room="otef_channel"):
        consumer = GeneralConsumer()
        consumer.room_group_name = room
        consumer.channel_layer = type("Layer", (), {"group_send": AsyncMock()})()
        consumer.send = AsyncMock()
        return consumer

    async def test_valid_batch_logs_once_then_acks_only_sender(self):
        consumer = self.make_consumer()
        with patch("websocket_app.projection_trace.projection_trace_logger.info") as log:
            await consumer.handle_otef_message(valid_batch())
        log.assert_called_once()
        logged = log.call_args.args[0]
        self.assertTrue(logged.startswith("[OTEF PROJECTION TRACE] "))
        envelope = json.loads(logged.removeprefix("[OTEF PROJECTION TRACE] "))
        self.assertEqual(envelope["seq"], 1)
        self.assertEqual(envelope["events"][0]["kind"], "pointer")
        consumer.send.assert_awaited_once_with(text_data=json.dumps({
            "type": "otef_projection_trace_ack", "version": 1,
            "sessionId": SESSION, "clientId": CLIENT, "seq": 1,
        }))
        consumer.channel_layer.group_send.assert_not_awaited()

    async def test_invalid_batches_are_rejected_without_logging_or_broadcast(self):
        consumer = self.make_consumer()
        base = valid_batch()
        bad_batches = [
            {**base, "unexpected": 1}, {**base, "version": True},
            {**base, "seq": 0}, {**base, "clientId": "not-a-uuid"},
            {**base, "events": []}, {**base, "events": base["events"] * 65},
            {**base, "events": [{"t": float("nan"), "kind": "pointer", "detail": {}}]},
            {**base, "events": [{"t": 1, "kind": "pointer", "detail": {"clientX": float("inf")}}]},
            {**base, "events": [{"t": 1, "kind": "pointer", "detail": {"clientX": True}}]},
            {**base, "events": [{"t": 1, "kind": "pointer", "detail": {"extra": "x"}}]},
            {**base, "events": [{"t": 1, "kind": "pointer", "detail": {"nested": {"x": 1}}}]},
            {**base, "events": [{"t": 1, "kind": "unknown", "detail": {}}]},
            {**base, "events": [{"t": 1, "kind": "pointer", "detail": {
                "phase": "p" * 120, "role": "r" * 120, "mode": "m" * 120,
                "baselineType": "b" * 120, "receiptType": "q" * 120,
                "visibilityState": "v" * 120,
            }}] * 64},
        ]
        with patch("websocket_app.projection_trace.projection_trace_logger.info") as log:
            for batch in bad_batches:
                await consumer.handle_otef_message(batch)
        log.assert_not_called()
        self.assertEqual(consumer.send.await_count, len(bad_batches))
        self.assertTrue(all(json.loads(call.kwargs["text_data"])["reason"] == "invalid_batch"
                            for call in consumer.send.await_args_list))
        consumer.channel_layer.group_send.assert_not_awaited()

    async def test_trace_is_rejected_outside_otef_room(self):
        consumer = self.make_consumer("dashboard_channel")
        with patch("websocket_app.projection_trace.projection_trace_logger.info") as log:
            await consumer.handle_otef_message(valid_batch())
        log.assert_not_called()
        consumer.send.assert_awaited_once()
        self.assertEqual(json.loads(consumer.send.await_args.kwargs["text_data"])["reason"], "invalid_batch")
        consumer.channel_layer.group_send.assert_not_awaited()

    async def test_logging_failure_returns_error_without_ack(self):
        consumer = self.make_consumer()
        with patch("websocket_app.projection_trace.projection_trace_logger.info", side_effect=OSError("disk")):
            await consumer.handle_otef_message(valid_batch())
        self.assertEqual(json.loads(consumer.send.await_args.kwargs["text_data"])["reason"], "log_failed")
        consumer.channel_layer.group_send.assert_not_awaited()

    async def test_real_stream_write_failure_returns_error_without_ack(self):
        from .projection_trace import projection_trace_logger
        consumer = self.make_consumer()
        handler = projection_trace_logger.handlers[0]
        stream = Mock()
        stream.write.side_effect = OSError('unavailable')
        with patch.object(handler, 'stream', stream):
            await consumer.handle_otef_message(valid_batch())
        self.assertEqual(json.loads(consumer.send.await_args.kwargs['text_data'])['reason'], 'log_failed')
        consumer.channel_layer.group_send.assert_not_awaited()
