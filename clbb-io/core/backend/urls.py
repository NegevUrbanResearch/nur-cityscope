from django.contrib import admin
from rest_framework.routers import DefaultRouter
from django.urls import path, include
from .views import (
    CustomActionsViewSet, IndicatorViewSet, StateViewSet,
    IndicatorDataViewSet, IndicatorImageViewSet, IndicatorGeojsonViewSet,
    DashboardFeedStateViewSet, LayerConfigViewSet
)

from django.db import models

from rest_framework import serializers, viewsets

router = DefaultRouter()

router.register(r'indicators', IndicatorViewSet, basename='indicator')
router.register(r'states', StateViewSet, basename='state')
router.register(r'indicator_data', IndicatorDataViewSet, basename='indicator_data')
router.register(r'indicator_images', IndicatorImageViewSet , basename='indicator_image')
router.register(r'indicator_geojson', IndicatorGeojsonViewSet , basename='indicator_geojson')
router.register(r'dashboard_feed_state', DashboardFeedStateViewSet , basename='dashboard_feed_state')
router.register(r'layer_config', LayerConfigViewSet , basename='layer_config')
router.register(r'actions', CustomActionsViewSet, basename='actions')


urlpatterns = [
    path('set_map_state/', CustomActionsViewSet.as_view({'get': 'receive_data_from_rfid'}), name='set_map_state'),
    # path('set_map_type/', CustomActionsViewSet.receive_data_from_buttons_page, name='set_map_type'),
] + router.urls