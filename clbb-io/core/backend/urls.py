from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    DashboardFeedStateViewSet, IndicatorGeojsonViewSet, MapTypeViewSet,
    CustomActionsViewSet, IndicatorViewSet, StateViewSet,
    IndicatorDataViewSet, IndicatorImageViewSet, LayerConfigViewSet
)

from django.db import models

from rest_framework import serializers, viewsets

router = DefaultRouter()

router.register(r'dashboard_feed_state', DashboardFeedStateViewSet, basename='dashboard-feed-state')
router.register(r'indicator_geojson', IndicatorGeojsonViewSet, basename='indicator-geojson')
router.register(r'map_type', MapTypeViewSet, basename='map-type')
router.register(r'indicators', IndicatorViewSet, basename='indicator')
router.register(r'states', StateViewSet, basename='state')
router.register(r'indicator_data', IndicatorDataViewSet, basename='indicator-data')
router.register(r'indicator_images', IndicatorImageViewSet, basename='indicator-image')
router.register(r'layer_config', LayerConfigViewSet, basename='layer-config')
router.register(r'actions', CustomActionsViewSet, basename='actions')

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include((router.urls, 'api'))),
]