from django.db import models
from rest_framework import serializers
from .models import (
    Table,
    Indicator,
    IndicatorData,
    IndicatorImage,
    State,
    DashboardFeedState,
    LayerConfig,
    GISLayer,
    OTEFModelConfig,
    OTEFViewportState,
)


class TableSerializer(serializers.ModelSerializer):
    indicator_count = serializers.SerializerMethodField()

    class Meta:
        model = Table
        fields = ["id", "name", "display_name", "description", "is_active", "created_at", "updated_at", "indicator_count"]

    def get_indicator_count(self, obj):
        return obj.indicators.count()


class IndicatorSerializer(serializers.ModelSerializer):
    table_name = serializers.CharField(source="table.name", read_only=True)
    table_display_name = serializers.CharField(source="table.display_name", read_only=True)
    state_count = serializers.SerializerMethodField()
    media_count = serializers.SerializerMethodField()

    class Meta:
        model = Indicator
        fields = "__all__"

    def get_state_count(self, obj):
        return obj.data.values('state').distinct().count()

    def get_media_count(self, obj):
        return IndicatorImage.objects.filter(indicatorData__indicator=obj).count()


class StateSerializer(serializers.ModelSerializer):
    class Meta:
        model = State
        fields = "__all__"


class IndicatorMediaSerializer(serializers.ModelSerializer):
    """Serializer for media with URL included"""
    url = serializers.SerializerMethodField()

    class Meta:
        model = IndicatorImage
        fields = ['id', 'url', 'media_type', 'uploaded_at']

    def get_url(self, obj):
        if obj.image:
            return obj.image.url
        return None


class StateDetailSerializer(serializers.ModelSerializer):
    """Serializer for state with nested media"""
    media = serializers.SerializerMethodField()

    class Meta:
        model = State
        fields = ['id', 'state_values', 'scenario_type', 'scenario_name', 'is_user_generated', 'media']

    def get_media(self, obj):
        # Get media through IndicatorData - requires indicator context
        indicator_data = getattr(obj, '_indicator_data', None)
        if indicator_data:
            media_list = []
            for img in indicator_data.images.all():
                media_list.append({
                    'id': img.id,
                    'url': img.image.url if img.image else None,
                    'media_type': img.media_type,
                    'uploaded_at': img.uploaded_at.isoformat() if img.uploaded_at else None
                })
            return media_list
        return []


class IndicatorDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer including nested states and media for hierarchy view"""
    table_name = serializers.CharField(source="table.name", read_only=True)
    table_display_name = serializers.CharField(source="table.display_name", read_only=True)
    states = serializers.SerializerMethodField()

    class Meta:
        model = Indicator
        fields = ['id', 'indicator_id', 'name', 'has_states', 'description', 'category',
                  'is_user_generated', 'table', 'table_name', 'table_display_name', 'states']

    def get_states(self, obj):
        """Get all states linked to this indicator with their media"""
        indicator_data_qs = obj.data.all().select_related('state').prefetch_related('images')
        states = {}

        for data in indicator_data_qs:
            state = data.state
            state_id = state.id

            if state_id not in states:
                states[state_id] = {
                    'id': state_id,
                    'state_values': state.state_values,
                    'scenario_type': state.scenario_type,
                    'scenario_name': state.scenario_name,
                    'is_user_generated': state.is_user_generated,
                    'indicator_data_id': data.id,
                    'media': []
                }

            # Add media for this indicator data
            for img in data.images.all():
                states[state_id]['media'].append({
                    'id': img.id,
                    'url': img.image.url if img.image else None,
                    'media_type': img.media_type,
                    'uploaded_at': img.uploaded_at.isoformat() if img.uploaded_at else None
                })

        return list(states.values())


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


class GISLayerSerializer(serializers.ModelSerializer):
    table_name = serializers.CharField(source="table.name", read_only=True)

    class Meta:
        model = GISLayer
        fields = "__all__"


class OTEFModelConfigSerializer(serializers.ModelSerializer):
    table_name = serializers.CharField(source="table.name", read_only=True)

    class Meta:
        model = OTEFModelConfig
        fields = "__all__"


class OTEFViewportStateSerializer(serializers.ModelSerializer):
    table_name = serializers.CharField(source="table.name", read_only=True)

    class Meta:
        model = OTEFViewportState
        fields = ['id', 'table', 'table_name', 'viewport', 'layers', 'animations', 'updated_at']
        read_only_fields = ['id', 'updated_at', 'table_name']

