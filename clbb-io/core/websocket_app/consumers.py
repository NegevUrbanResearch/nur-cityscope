# consumers.py
from channels.generic.websocket import AsyncWebsocketConsumer
from .utils.data_updater import DataUpdater
import json

class GeneralConsumer(AsyncWebsocketConsumer):
    def __init__(self, *args, **kwargs):        
        self.dataUpdater = DataUpdater()
        self.active_channels = {}
        super().__init__(*args, **kwargs)

    async def connect(self):
        # Obtenemos un parámetro del query string (puede ser 'map' o 'dashboard', por ejemplo)
        self.channel_type = self.scope['url_route']['kwargs']['channel_type']  # 'map' o 'dashboard'
        
        # Determinamos el nombre del grupo dependiendo del tipo de canal
        self.room_group_name = f'{self.channel_type}_channel'
        
        if self.room_group_name not in self.active_channels:
            self.active_channels[self.room_group_name] = set()
        
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        self.active_channels[self.room_group_name].add(self.channel_name)
        print(self.active_channels)
        await self.accept()

    async def disconnect(self, close_code):
        if self.room_group_name in self.active_channels:
            self.active_channels[self.room_group_name].discard(self.channel_name)
            if not self.active_channels[self.room_group_name]:  # Si no quedan más canales en el grupo, eliminar la entrada
                del self.active_channels[self.room_group_name]

        # Salir del grupo correspondiente
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def send_message(self, event):
        # Envía un mensaje a los clientes conectados
        # message = event['message']
        # print(message)
        # await self.send(text_data=json.dumps({
        #     'message': message
        # }))
        pass

    async def update_data(self, event):
        print(event)
        # channel_type = event['channel_type']
        # indicator_id = event['message']['indicator_id']
        # data = await self.dataUpdater.input_event(event)
        # print(data)
        # event = {
        #     'message': data
        # }
        # print(event)
        # await self.send_message(text_data = json.dumps(
        #        event
        #     )
        # )

        # print(self.results)
        # if results:
        #     for channel in 
        #     await self.dataUpdater.send_data_to_channel()
        # Envía un mensaje a los clientes conectados
        # data = event['data']
        # await self.send(text_data=json.dumps({
        #     'data': data
        # }))
