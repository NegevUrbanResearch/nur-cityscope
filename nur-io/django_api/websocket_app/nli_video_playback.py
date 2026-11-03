"""Validated, ephemeral NLI playback messages; no stored playback state."""


def valid_nli_video_playback(data, channel_type):
    if not isinstance(data, dict) or data.get('table') != channel_type:
        return None
    table = data.get('table')
    if not isinstance(table, str) or not 0 < len(table) <= 128:
        return None
    message_type = data.get('type')
    if message_type == 'otef_nli_video_playback_state':
        if set(data) != {'type', 'table', 'sourceId', 'sequence', 'active'}:
            return None
        identity = data['sourceId']
        if type(data['sequence']) is not int or not 0 < data['sequence'] <= 9007199254740991:
            return None
        if type(data['active']) is not bool:
            return None
    elif message_type == 'otef_nli_video_playback_query':
        if set(data) != {'type', 'table', 'requesterId'}:
            return None
        identity = data['requesterId']
    else:
        return None
    if not isinstance(identity, str) or not 0 < len(identity) <= 128:
        return None
    return dict(data)
