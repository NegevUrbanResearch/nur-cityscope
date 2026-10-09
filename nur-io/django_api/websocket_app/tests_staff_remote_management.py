import asyncio
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock

from .consumers import GeneralConsumer
from .staff_remote_management import (
    disconnect_staff_remote_management,
    handle_staff_remote_management,
    validate_staff_remote_message,
)

REMOTE = "11111111-1111-4111-8111-111111111111"
INSTANCE = "22222222-2222-4222-8222-222222222222"
SOURCE = "33333333-3333-4333-8333-333333333333"
REQUEST = "44444444-4444-4444-8444-444444444444"


def status(**changes):
    return {"type": "otef_staff_remote_status", "table": "otef", "remoteId": REMOTE,
            "instanceId": INSTANCE, "connectionSeq": 1, "leaseSeq": 1, "buildId": None,
            "visibility": "visible", "ready": True, "refreshBlockReason": None,
            "reloadReceipt": None, **changes}


def observer():
    value = GeneralConsumer()
    value.channel_type = "otef"
    value.room_group_name = "otef_channel"
    value.channel_name = "observer-channel"
    value.channel_layer = type("Layer", (), {"group_add": AsyncMock(), "group_discard": AsyncMock(), "group_send": AsyncMock()})()
    return value


class StaffRemoteManagementTests(IsolatedAsyncioTestCase):
    async def test_schemas_room_identity_and_server_only_disconnect(self):
        self.assertIsNotNone(validate_staff_remote_message(status()))
        invalid = [
            status(extra=True), status(remoteId="bad"), status(connectionSeq=True),
            status(leaseSeq=0), status(buildId="x" * 65), status(visibility="visible!"),
            status(visibility=[]), status(refreshBlockReason=[]), status(ready=1),
            status(reloadReceipt={"sourceId": SOURCE}),
            {"type": "otef_staff_remote_disconnected", "table": "otef", "remoteId": REMOTE,
             "instanceId": INSTANCE, "connectionSeq": 1},
        ]
        for item in invalid:
            self.assertIsNone(validate_staff_remote_message(item))
        ack = {"type": "otef_staff_remote_refresh_ack", "table": "otef", "sourceId": SOURCE,
               "requestId": REQUEST, "remoteId": REMOTE, "instanceId": INSTANCE,
               "connectionSeq": 1, "result": "rejected", "reason": []}
        self.assertIsNone(validate_staff_remote_message(ack))
        consumer = observer()
        consumer.channel_type = "presentation"
        self.assertTrue(await handle_staff_remote_management(consumer, status()))
        consumer.channel_layer.group_send.assert_not_awaited()
        self.assertFalse(await handle_staff_remote_management(consumer, {"type": "otef_viewport_update"}))

    async def test_observer_report_refresh_ack_disconnect_are_isolated(self):
        config = observer()
        subscribe = {"type": "otef_staff_remote_subscribe", "table": "otef", "sourceId": SOURCE}
        self.assertTrue(await handle_staff_remote_management(config, subscribe))
        self.assertIn("staff_remote_observer_" + SOURCE, config._staff_remote_groups)

        tablet = observer()
        await handle_staff_remote_management(tablet, status())
        tablet.channel_layer.group_send.assert_awaited()
        groups = [call.args[0] for call in tablet.channel_layer.group_send.await_args_list]
        self.assertNotIn("otef_channel", groups)
        self.assertIn("staff_remote_producers", tablet._staff_remote_groups)
        target = next(group for group in tablet._staff_remote_groups if group.startswith("staff_remote_target_"))

        refresh = {"type": "otef_staff_remote_refresh", "table": "otef", "sourceId": SOURCE,
                   "requestId": REQUEST, "remoteId": REMOTE, "instanceId": INSTANCE,
                   "connectionSeq": 1, "leaseSeq": 1}
        await handle_staff_remote_management(config, refresh)
        self.assertEqual(config.channel_layer.group_send.await_args.args[0], target)
        ack = {"type": "otef_staff_remote_refresh_ack", "table": "otef", "sourceId": SOURCE,
               "requestId": REQUEST, "remoteId": REMOTE, "instanceId": INSTANCE,
               "connectionSeq": 1, "result": "accepted", "reason": None}
        await handle_staff_remote_management(tablet, ack)
        self.assertEqual(tablet.channel_layer.group_send.await_args.args[0], "staff_remote_observer_" + SOURCE)

        await disconnect_staff_remote_management(tablet)
        self.assertIsNone(tablet._staff_remote_renewal)
        self.assertEqual(tablet._staff_remote_groups, set())
        disconnected = tablet.channel_layer.group_send.await_args_list[-1]
        self.assertEqual(disconnected.args[0], "staff_remote_observers_all")
        self.assertEqual(disconnected.args[1]["message"]["type"], "otef_staff_remote_disconnected")
        await disconnect_staff_remote_management(config)

    async def test_observer_subscription_is_bound_and_producer_query_group_is_bounded(self):
        config = observer()
        subscribe = {"type": "otef_staff_remote_subscribe", "table": "otef", "sourceId": SOURCE}
        await handle_staff_remote_management(config, subscribe)
        query = {"type": "otef_staff_remote_status_query", "table": "otef", "sourceId": SOURCE}
        await handle_staff_remote_management(config, query)
        self.assertEqual(config.channel_layer.group_send.await_args.args[0], "staff_remote_producers")
        self.assertEqual(config.channel_layer.group_send.await_args.args[1]["message"], query)
        sends_before_switch = config.channel_layer.group_send.await_count
        other_source = "55555555-5555-4555-8555-555555555555"
        await handle_staff_remote_management(config, {**subscribe, "sourceId": other_source})
        self.assertEqual(config.channel_layer.group_send.await_count, sends_before_switch)
        self.assertNotIn("staff_remote_observer_" + other_source, config._staff_remote_groups)
        await disconnect_staff_remote_management(config)

        tablet = observer()
        max_counter_status = status(connectionSeq=9_007_199_254_740_991)
        await handle_staff_remote_management(tablet, max_counter_status)
        target_group = [name for name in tablet._staff_remote_groups if name.startswith("staff_remote_target_")][0]
        self.assertLessEqual(len(target_group), 100)
        await disconnect_staff_remote_management(tablet)

    async def test_role_cannot_switch_between_observer_and_producer(self):
        tablet = observer()
        await handle_staff_remote_management(tablet, status())
        subscribe = {"type": "otef_staff_remote_subscribe", "table": "otef", "sourceId": SOURCE}
        await handle_staff_remote_management(tablet, subscribe)
        self.assertEqual(tablet._staff_remote_role, "producer")
        self.assertNotIn("staff_remote_observer_" + SOURCE, tablet._staff_remote_groups)
        await disconnect_staff_remote_management(tablet)

        config = observer()
        await handle_staff_remote_management(config, subscribe)
        await handle_staff_remote_management(config, status())
        self.assertEqual(config._staff_remote_role, "observer")
        self.assertNotIn("staff_remote_producers", config._staff_remote_groups)
        await disconnect_staff_remote_management(config)

    async def test_status_wire_payload_matches_shared_validator_and_stays_exact(self):
        tablet = observer()
        incoming = status()
        await handle_staff_remote_management(tablet, incoming)
        delivered = tablet.channel_layer.group_send.await_args.args[1]["message"]
        self.assertEqual(delivered, incoming)
        self.assertIsNone(validate_staff_remote_message({**delivered, "_receivedMonotonic": 1}))
        self.assertNotIn("_receivedMonotonic", delivered)
        self.assertNotIn("_receivedWall", delivered)
        await disconnect_staff_remote_management(tablet)

    async def test_disconnect_awaits_timer_and_discards_even_when_notice_fails(self):
        tablet = observer()
        await handle_staff_remote_management(tablet, status())
        renewal_task = tablet._staff_remote_renewal
        tablet.channel_layer.group_send.side_effect = RuntimeError("channel layer unavailable")
        await disconnect_staff_remote_management(tablet)
        self.assertTrue(renewal_task.done())
        self.assertTrue(renewal_task.cancelled())
        self.assertEqual(tablet.channel_layer.group_discard.await_count, 2)
        self.assertEqual(tablet._staff_remote_groups, set())

    async def test_failed_hourly_renewal_is_awaited_and_disconnect_still_discards(self):
        tablet = observer()
        gate = asyncio.Event()

        async def fake_sleep(delay):
            self.assertEqual(delay, 3600)
            await gate.wait()

        tablet._staff_remote_sleep = fake_sleep
        await handle_staff_remote_management(tablet, status())
        task = tablet._staff_remote_renewal
        tablet.channel_layer.group_add.side_effect = RuntimeError("renewal failed")
        gate.set()
        with self.assertRaises(RuntimeError):
            await task
        await disconnect_staff_remote_management(tablet)
        self.assertEqual(tablet.channel_layer.group_discard.await_count, 2)
        self.assertEqual(tablet._staff_remote_groups, set())

    async def test_one_hourly_silent_timer_renews_every_joined_group_for_both_roles(self):
        async def verify_role(register):
            consumer = observer()
            gates = []

            async def fake_sleep(delay):
                self.assertEqual(delay, 3600)
                gate = asyncio.Event()
                gates.append(gate)
                await gate.wait()

            consumer._staff_remote_sleep = fake_sleep
            await register(consumer)
            groups = set(consumer._staff_remote_groups)
            timer = consumer._staff_remote_renewal
            from .staff_remote_management import _ensure_renewal
            _ensure_renewal(consumer)
            self.assertIs(consumer._staff_remote_renewal, timer)
            for _ in range(10):
                await asyncio.sleep(0)
                if gates:
                    break
            self.assertEqual(len(gates), 1)
            send_count = consumer.channel_layer.group_send.await_count
            add_count = consumer.channel_layer.group_add.await_count
            gates[0].set()
            for _ in range(10):
                await asyncio.sleep(0)
                if consumer.channel_layer.group_add.await_count >= add_count + len(groups):
                    break
            renewed = [call.args[0] for call in consumer.channel_layer.group_add.await_args_list[add_count:]]
            self.assertEqual(set(renewed), groups)
            self.assertEqual(consumer.channel_layer.group_send.await_count, send_count)
            await disconnect_staff_remote_management(consumer)
            self.assertTrue(timer.cancelled())

        await verify_role(lambda consumer: handle_staff_remote_management(
            consumer, {"type": "otef_staff_remote_subscribe", "table": "otef", "sourceId": SOURCE}))
        await verify_role(lambda consumer: handle_staff_remote_management(consumer, status()))

    async def test_bound_role_and_connection_identity_cannot_change(self):
        tablet = observer()
        await handle_staff_remote_management(tablet, status())
        before = tablet.channel_layer.group_send.await_count
        await handle_staff_remote_management(tablet, status(instanceId=SOURCE, leaseSeq=2))
        self.assertEqual(tablet.channel_layer.group_send.await_count, before)
        await handle_staff_remote_management(tablet, status(leaseSeq=1))
        self.assertEqual(tablet.channel_layer.group_send.await_count, before)
        await disconnect_staff_remote_management(tablet)

    async def test_management_dispatch_never_calls_state_or_general_room(self):
        consumer = observer()
        consumer._save_layers = AsyncMock()
        consumer._save_viewport = AsyncMock()
        await consumer.handle_otef_message(status())
        await consumer.handle_otef_message({"type": "otef_staff_remote_disconnected", "table": "otef",
                                            "remoteId": REMOTE, "instanceId": INSTANCE, "connectionSeq": 1})
        consumer._save_layers.assert_not_awaited()
        consumer._save_viewport.assert_not_awaited()
        self.assertTrue(all(call.args[0] != "otef_channel" for call in consumer.channel_layer.group_send.await_args_list))
        await disconnect_staff_remote_management(consumer)
