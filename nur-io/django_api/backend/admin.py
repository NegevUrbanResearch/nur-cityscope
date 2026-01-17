from django.contrib import admin

from .models import (
    Table,
    Indicator,
    State,
    IndicatorData,
    IndicatorImage,
    DashboardFeedState,
    LayerConfig,
    GISLayer,
    OTEFModelConfig,
    OTEFViewportState,
)

admin.site.register(Table)
admin.site.register(Indicator)
admin.site.register(State)
admin.site.register(IndicatorData)
admin.site.register(IndicatorImage)
admin.site.register(DashboardFeedState)
admin.site.register(LayerConfig)
admin.site.register(GISLayer)
admin.site.register(OTEFModelConfig)
admin.site.register(OTEFViewportState)