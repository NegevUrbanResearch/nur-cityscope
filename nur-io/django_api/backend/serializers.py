from django.db import models
from rest_framework import serializers
from .models import (
    Indicator,
    IndicatorData,
    IndicatorImage,
    State,
    DashboardFeedState,
    LayerConfig,
    UserUpload,
    UserUploadCategory,
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


class UserUploadCategorySerializer(serializers.ModelSerializer):
    upload_count = serializers.SerializerMethodField()

    class Meta:
        model = UserUploadCategory
        fields = ["id", "name", "display_name", "created_at", "is_default", "upload_count"]

    def get_upload_count(self, obj):
        return obj.uploads.count()


class UserUploadSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()
    category_name = serializers.SerializerMethodField()

    class Meta:
        model = UserUpload
        fields = ["id", "display_name", "original_filename", "uploaded_at", "file_size", "image_url", "category", "category_name"]

    def get_image_url(self, obj):
        if obj.image:
            return obj.image.url
        return None

    def get_category_name(self, obj):
        return obj.category.display_name if obj.category else None
