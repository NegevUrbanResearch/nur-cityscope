from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework import routers
from . import views
from .views import (
    TableViewSet,
    DashboardFeedStateViewSet,
    CustomActionsViewSet,
    IndicatorViewSet,
    StateViewSet,
    IndicatorDataViewSet,
    IndicatorImageViewSet,
    LayerConfigViewSet,
    UserUploadViewSet,
    UserUploadCategoryViewSet,
    ImageUploadView,
    serve_map_file,
)

from rest_framework import permissions
from drf_yasg.views import get_schema_view
from drf_yasg import openapi

schema_view = get_schema_view(
    openapi.Info(
        title="nur CityScope API",
        default_version="v1",
        description="Auto-generated API documentation for nur CityScope",
    ),
    public=True,
    permission_classes=(permissions.AllowAny,),
)

router = DefaultRouter()

router.register(r"tables", TableViewSet, basename="table")
router.register(
    r"dashboard_feed_state", DashboardFeedStateViewSet, basename="dashboard-feed-state"
)
router.register(r"indicators", IndicatorViewSet, basename="indicator")
router.register(r"states", StateViewSet, basename="state")
router.register(r"indicator_data", IndicatorDataViewSet, basename="indicator-data")
router.register(r"indicator_images", IndicatorImageViewSet, basename="indicator-image")
router.register(r"layer_config", LayerConfigViewSet, basename="layer-config")
router.register(r"user_uploads", UserUploadViewSet, basename="user-upload")
router.register(r"user_upload_categories", UserUploadCategoryViewSet, basename="user-upload-category")
router.register(r"actions", CustomActionsViewSet, basename="actions")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include((router.urls, "api"))),
    # API Documentation endpoints
    # Visit /swagger/ for interactive API explorer (Swagger UI)
    # Visit /redoc/ for a clean, readable API reference (ReDoc UI)
    # Visit /swagger.json for the raw OpenAPI schema
    path(
        "swagger/",
        schema_view.with_ui("swagger", cache_timeout=0),
        name="schema-swagger-ui",
    ),
    path("redoc/", schema_view.with_ui("redoc", cache_timeout=0), name="schema-redoc"),
    path("swagger.json", schema_view.without_ui(cache_timeout=0), name="schema-json"),
    # Add the new image upload endpoint
    path("upload_image/", ImageUploadView.as_view(), name="upload_image"),
    # For serving map files directly
    path("maps/<path:path>", serve_map_file, name="serve_map_file"),
]
