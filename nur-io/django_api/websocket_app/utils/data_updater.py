from backend import models
from asgiref.sync import sync_to_async


class DataUpdater:
    def __init__(self):
        self.indicator_id = None
        self.indicator_states = None

    # Método para realizar la consulta sincrónica de manera asíncrona
    @sync_to_async
    def get_indicator(self, indicator_id, table_name):
        # Table parameter is required
        if not table_name:
            raise ValueError("Table parameter is required")
        
        table = models.Table.objects.filter(name=table_name).first()
        if not table:
            raise ValueError(f"Table '{table_name}' not found")
        
        return list(models.Indicator.objects.filter(table=table, indicator_id=indicator_id))

    # Método para realizar la consulta de los datos del indicador
    @sync_to_async
    def get_indicator_data(self, indicator_id, states):
        return list(
            models.IndicatorData.objects.get(
                indicator__indicator_id=indicator_id, state__state_values=states
            )
        )

    async def find_map(self, event):
        message = event.get("message", [])
        print(message)
        self.indicator_id = message.get("indicator_id", 0)
        print(self.indicator_id)

        # # Obtener el indicador usando el método asíncrono
        # indicator_results = await self.get_indicator(self.indicator_id)
        # print(indicator_results)

        # # Si no hay resultados
        # if not indicator_results:
        #     return None
        # elif len(indicator_results) > 1:
        #     states = message.get('states', {})
        #     # Obtener los datos del indicador usando el método asíncrono
        # else:
        #     states = {}

        # indicator_result = await self.get_indicator_data(self.indicator_id, states)

        # indicator_result = indicator_results[0]
        # print(indicator_result)
        # self.indicator_result = indicator_result
        pass

    async def find_dashboard(self, event):
        message = event.get("message", [])

        states = message.get("states", {})

        dashboard_object = models.DashboardFeedState.objects.get(
            state__state_values=states
        )[0]

        json_result = dashboard_object.data
        self.indicator_result = json_result
        pass

    async def input_event(self, event):
        print(event)
        self.channel_type = event.get("channel_type", "")

        if "map" in self.channel_type:
            await self.find_map(event)
        elif "dashboard" in self.channel_type:
            await self.find_dashboard(event)

        try:
            return await self.get_source()
        except Exception as e:
            print(e)
            return None

    async def get_source(self):
        channel_id = self.channel_type.replace("_channel", "")
        try:
            if channel_id == "map_image":
                data = models.IndicatorImage.objects.filter(
                    indicatorData=self.indicator_result
                )
                return data[0].image.url
            # elif channel_id == 'map_geojson':
            #     # IndicatorGeojson model has been removed
            #     return None
            elif channel_id == "dashboard_feed":
                data = models.DashboardFeedState.objects.filter(
                    state=self.indicator_result
                )
                return data[0].data
        except Exception as e:
            print(e)
            return None
