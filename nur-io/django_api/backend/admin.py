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


@admin.register(OTEFViewportState)
class OTEFViewportStateAdmin(admin.ModelAdmin):
    readonly_fields = (
        "nli_clock_layout",
        "nli_clock_layout_revision",
        "legend_settings",
        "legend_layout_revision",
        "settlement_name_settings",
        "settlement_name_revision",
    )
