import { OTEFWebSocketClient } from "./websocket-client.js";

const TYPES = {
  state: "otef_nli_video_playback_state",
  query: "otef_nli_video_playback_query",
};

export const defaultClientFactory = (url) => new OTEFWebSocketClient(url);

// This adapter only sends locally generated messages. Received messages are
// delivered to the lease owner and never forwarded to another transport.
export function openNliVideoPlaybackWebSocket({
  table, onMessage, onConnect, warn,
  clientFactory = defaultClientFactory,
  socket = null,
} = {}) {
  if (!socket && (!clientFactory || (clientFactory === defaultClientFactory &&
      (typeof globalThis.WebSocket !== "function" || !globalThis.window)))) return null;
  let client;
  try { client = socket || clientFactory(`/ws/${encodeURIComponent(table)}/`); }
  catch (error) { warn?.("NLI video playback WebSocket could not open", error); return null; }
  let closed = false;
  const receiveState = (message) => { if (!closed) onMessage({ data: { ...message, type: "state" } }); };
  const receiveQuery = (message) => { if (!closed) onMessage({ data: { ...message, type: "query" } }); };
  const connected = () => { if (!closed) onConnect(); };
  client.on(TYPES.state, receiveState);
  client.on(TYPES.query, receiveQuery);
  client.on("connect", connected);
  return {
    connect() {
      try {
        if (socket) { if (client.getConnected()) connected(); }
        else client.connect();
      }
      catch (error) { warn?.("NLI video playback WebSocket could not connect", error); }
    },
    postMessage(message) {
      if (closed || !TYPES[message.type] || !client.getConnected()) return false;
      try { return client.send({ ...message, type: TYPES[message.type] }); }
      catch (error) { warn?.("NLI video playback WebSocket could not publish", error); return false; }
    },
    close() {
      closed = true;
      client.off(TYPES.state, receiveState);
      client.off(TYPES.query, receiveQuery);
      client.off("connect", connected);
      if (!socket) client.disconnect();
    },
  };
}
