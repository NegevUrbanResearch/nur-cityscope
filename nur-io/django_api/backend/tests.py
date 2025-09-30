from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import status
from .models import DashboardFeedState, MapType, State, IndicatorData, Indicator

# Create your tests here.

class DashboardFeedStateTests(APITestCase):
    def setUp(self):
        # Create test data
        self.test_state = State.objects.create(
            state_values={'population': 1000, 'green_space': 500, 'building_height': 30}
        )
        self.test_feed_state = DashboardFeedState.objects.create(
            state=self.test_state,
            data={'population': 1000, 'green_space': 500, 'building_height': 30}
        )

    def test_get_dashboard_feed_state(self):
        url = reverse('api:dashboard-feed-state-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[0]['data']['population'], 1000)
        self.assertEqual(response.data[0]['data']['green_space'], 500)
        self.assertEqual(response.data[0]['data']['building_height'], 30)

class MapTypeTests(APITestCase):
    def setUp(self):
        # Create test data
        self.test_map_type = MapType.objects.create(
            name="Test Map",
            description="Test Description"
        )

    def test_get_map_type(self):
        url = reverse('api:map-type-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['name'], "Test Map")

class APIDocumentationTests(APITestCase):
    def test_swagger_ui(self):
        url = reverse('schema-swagger-ui')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_redoc_ui(self):
        url = reverse('schema-redoc')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_swagger_json(self):
        url = reverse('schema-json')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
