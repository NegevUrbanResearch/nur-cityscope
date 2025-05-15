from django.contrib import admin

from .models import (
    Indicator,
    State,
    IndicatorData,
    IndicatorImage,
    IndicatorGeojson,
    DashboardFeedState,
    LayerConfig
)

admin.site.register(Indicator)
admin.site.register(State)
admin.site.register(IndicatorData)
admin.site.register(IndicatorImage)
admin.site.register(IndicatorGeojson)
admin.site.register(DashboardFeedState)
admin.site.register(LayerConfig)
