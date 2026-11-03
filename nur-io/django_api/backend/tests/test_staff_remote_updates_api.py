import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Event

from django.apps import apps
from django.db import connections
from django.test import Client, TestCase, TransactionTestCase, override_settings

from backend.models import Table

URL = "/api/otef/staff-remote-management/"
DEVICE = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
A = "frontend-aaaaaaaaaaaaaaaa"
B = "frontend-bbbbbbbbbbbbbbbb"


def post(client, action, **fields):
    return client.post(URL, {"table": "otef", "action": action, **fields}, content_type="application/json")


def register(client, device=DEVICE, revision=0, replacement=None):
    return post(client, "register", deviceId=device, expectedRevision=revision, replaceDeviceId=replacement)


def send(client, target=A, revision=1, device=DEVICE):
    return post(client, "send_notice", deviceId=device, expectedRevision=revision, targetBuildId=target)


@override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}})
class StaffRemoteUpdatesApiTests(TestCase):
    def setUp(self):
        Table.objects.create(name="otef", display_name="OTEF")

    def test_default_read_does_not_create_a_registration(self):
        response = self.client.get(URL, {"table": "otef"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"table": "otef", "revision": 0, "deviceId": None, "notice": None})
        model = apps.get_model("backend", "OTEFStaffRemoteUpdates")
        self.assertEqual(model.objects.count(), 0)

    def test_registration_retry_and_explicit_replacement(self):
        first = register(self.client)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["revision"], 1)
        self.assertEqual(register(self.client).json(), first.json())
        self.assertEqual(register(self.client, OTHER, 1).status_code, 409)
        self.assertEqual(send(self.client).status_code, 200)
        replaced = register(self.client, OTHER, 2, DEVICE)
        self.assertEqual(replaced.status_code, 200)
        self.assertEqual(replaced.json(), {"table": "otef", "revision": 3, "deviceId": OTHER, "notice": None})
        self.assertEqual(self.client.get(URL, {"table": "otef", "deviceId": DEVICE}).json()["error"], "unregistered")
        self.assertEqual(register(self.client).status_code, 409)

    def test_latest_notice_and_same_target_retry(self):
        register(self.client)
        first = send(self.client)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["notice"]["targetBuildId"], A)
        self.assertEqual(send(self.client).json(), first.json())
        newer = send(self.client, B, 2)
        self.assertEqual(newer.status_code, 200)
        self.assertEqual(newer.json()["revision"], 3)
        stale = send(self.client, A, 1)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["state"], newer.json())
        self.assertEqual(Client().get(URL, {"table": "otef"}).json(), newer.json())

    def test_invalid_mutations_do_not_change_state(self):
        register(self.client)
        for fields in [{"expectedRevision": True}, {"expectedRevision": -1},
                       {"expectedRevision": 2**53}, {"deviceId": "bad"},
                       {"targetBuildId": "bad"}, {"extra": True}]:
            response = post(self.client, "send_notice", **{
                "deviceId": DEVICE, "expectedRevision": 1, "targetBuildId": A, **fields})
            self.assertEqual(response.status_code, 400, fields)
        self.assertEqual(send(self.client, device=OTHER).json()["error"], "unregistered")
        self.assertEqual(self.client.get(URL, {"table": "unknown"}).status_code, 404)
        self.assertEqual(self.client.get(URL, {"table": "otef", "deviceId": "bad"}).status_code, 400)
        self.assertIsNone(self.client.get(URL, {"table": "otef"}).json()["notice"])

    def test_changes_signal_only_after_commit_and_malformed_action_is_rejected(self):
        with self.captureOnCommitCallbacks(execute=False) as callbacks:
            self.assertEqual(register(self.client).status_code, 200)
        self.assertEqual(len(callbacks), 1)
        self.assertEqual(post(self.client, [], deviceId=DEVICE, expectedRevision=1, targetBuildId=A).status_code, 400)


@override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}})
class StaffRemoteUpdatesConcurrencyTests(TransactionTestCase):
    def setUp(self):
        Table.objects.create(name="otef", display_name="OTEF")

    def test_delayed_send_cannot_replace_a_later_notice(self):
        self.assertEqual(register(self.client).status_code, 200)
        release = Event()

        def delayed():
            try:
                release.wait(5)
                return send(Client(), A, 1).status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as workers:
            result = workers.submit(delayed)
            newer = send(self.client, B, 1)
            self.assertEqual(newer.status_code, 200)
            release.set()
            self.assertEqual(result.result(10), 409)
        self.assertEqual(self.client.get(URL, {"table": "otef"}).json()["notice"]["targetBuildId"], B)

    def test_two_initial_registrations_leave_one_slot(self):
        def attempt(device):
            try:
                return register(Client(), device).status_code
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(attempt, [DEVICE, OTHER]))
        self.assertEqual(sorted(results), [200, 409])
        self.assertEqual(apps.get_model("backend", "OTEFStaffRemoteUpdates").objects.count(), 1)
