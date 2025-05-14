# websocket_app/routing.py
from django.urls import re_path
from .consumers import GeneralConsumer

websocket_urlpatterns = [
    re_path(r'ws/(?P<channel_type>\w+)/$', GeneralConsumer.as_asgi()),
]
