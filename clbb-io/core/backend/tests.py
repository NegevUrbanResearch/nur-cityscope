from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import status
from .models import DashboardFeedState, IndicatorGeojson, MapType, State, IndicatorData, Indicator

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

class IndicatorGeojsonTests(APITestCase):
    def setUp(self):
        # Create test data
        self.test_indicator = Indicator.objects.create(
            indicator_id=1,
            name="Test Indicator",
            has_states=True
        )
        self.test_state = State.objects.create(
            state_values={'test': 'value'}
        )
        self.test_indicator_data = IndicatorData.objects.create(
            indicator=self.test_indicator,
            state=self.test_state
        )
        self.test_geojson = IndicatorGeojson.objects.create(
            indicatorData=self.test_indicator_data,
            geojson={"type": "FeatureCollection", "features": []}
        )

    def test_get_indicator_geojson(self):
        url = reverse('api:indicator-geojson-list')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['indicatorData'], self.test_indicator_data.id)

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
