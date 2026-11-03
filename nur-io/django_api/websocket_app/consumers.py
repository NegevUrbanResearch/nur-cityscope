import json

from channels.generic.websocket import AsyncWebsocketConsumer


class GeneralConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.channel_type = self.scope["url_route"]["kwargs"]["channel_type"]
        self.room_group_name = f"{self.channel_type}_channel"
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return
        message_type = data.get("type", "unknown")
        if message_type.endswith("_changed"):
            return
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "broadcast_message",
                "message": data,
            },
        )

    async def broadcast_message(self, event):
        await self.send(text_data=json.dumps(event["message"]))

    async def presentation_update(self, event):
        await self.send(text_data=json.dumps({
            "type": "presentation_update",
            "data": event["data"],
        }))

    async def indicator_update(self, event):
        await self.send(text_data=json.dumps({
            "type": "indicator_update",
            "data": event["data"],
        }))
