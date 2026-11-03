from django.contrib import admin

from .models import (
    DashboardFeedState,
    Indicator,
    IndicatorData,
    IndicatorImage,
    LayerConfig,
    State,
    Table,
)

admin.site.register(Table)
admin.site.register(Indicator)
admin.site.register(State)
admin.site.register(IndicatorData)
admin.site.register(IndicatorImage)
admin.site.register(DashboardFeedState)
admin.site.register(LayerConfig)
