from django.db import models
from rest_framework import serializers
from .models import (
    Indicator,
    IndicatorData,
    IndicatorImage,
    State,
    DashboardFeedState,
    LayerConfig,
)


class IndicatorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Indicator
        fields = "__all__"


class StateSerializer(serializers.ModelSerializer):
    class Meta:
        model = State
        fields = "__all__"


class IndicatorDataSerializer(serializers.ModelSerializer):
    class Meta:
        model = IndicatorData
        fields = "__all__"


class IndicatorImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = IndicatorImage
        fields = "__all__"


class DashboardFeedStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = DashboardFeedState
        fields = "__all__"


class LayerConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = LayerConfig
        fields = "__all__"
