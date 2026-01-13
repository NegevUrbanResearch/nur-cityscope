# OTEF Interactive Projection Module

Interactive mapping module for the OTEF physical model with synchronized projection mapping.

## Features

- Interactive Leaflet map with OpenStreetMap/Satellite basemap
- Real-time coordinate transformation (EPSG:2039 ↔ WGS84)
- 25,516 parcels with land-use styling (simplified from 500K+ vertices)
- Road network visualization (simplified from 37K+ vertices)
- Physical model overlay with transparent background
- Real-time WebSocket sync between interactive map and projection display
- Mobile remote controller for touch-based navigation
- Viewport highlighting on physical model
- Layer toggles with dynamic legends
- Maptastic.js calibration for projection adjustment

## Requirements

- **WebSocket Channel**: `ws://host/ws/otef/`
- **Redis**: Required for WebSocket synchronization. Ensure Redis is running: `docker ps | grep redis`

## Usage

### Control Interface (User Device)
Access at: `http://localhost/otef-interactive/`

- Pan/zoom to explore the map
- Tap features for information
- Toggle layers via menu button
- Connection status indicator shows sync state

### Projection Display (Projector)
Access at: `http://localhost/otef-interactive/projection.html`

- Full-screen projection view
- Highlights current viewport from control interface
- Press **Shift+Z** to enter calibration mode
- Press **F** for fullscreen
- Press **X** to reset calibration

### Remote Controller (Mobile Device)
Access at: `http://localhost/otef-interactive/remote-controller.html`

- Directional pad and virtual joystick for map navigation
- Zoom slider and controls (10-19)
- Layer toggles (Roads, Parcels, Model Base)
- Connection status indicator
- Real-time synchronization with main map