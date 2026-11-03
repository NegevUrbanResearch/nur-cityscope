# nur-CityScope Frontend

React dashboard for urban planning visualization with interactive maps and charts.

## Tech Stack

- React 18 + React Router
- Material UI 7
- Deck.gl + Mapbox GL
- Chart.js + Recharts
- WebSocket for real-time updates

## Features

- **Dashboard**: Main visualization with indicator switching (mobility/climate)
- **Presentation Mode**: Full-screen slideshow with automated sequencing (accessible from dashboard)
- **UGC Management**: User-generated content indicators
- **Charts Drawer**: Collapsible panel with indicator-specific visualizations

## Routes

| Route | Description |
|-------|-------------|
| `/dashboard/` | Redirects to `/dashboard/mobility` |
| `/dashboard/mobility` | Mobility visualizations (default) |
| `/dashboard/climate` | Climate scenario comparisons |
| `/dashboard/user-uploads` | Image upload/management |

Note: Presentation mode is a feature within the dashboard, not a separate route. Access it via the charts drawer.

## Development

```bash
npm install
npm start          # Development server on :3000
npm run build      # Production build
```

## Environment

```env
REACT_APP_MAPBOX_ACCESS_TOKEN=pk.xxx  # Required for maps
```

## Project Structure

```
src/
├── components/
│   ├── charts/          # BarChart, PieChart, RadarChart, etc.
│   ├── drawer/          # ChartsDrawer, indicator-specific panels
│   ├── maps/            # DeckGLMap component
│   ├── Navbar.jsx       # Navigation with indicator switching
│   └── MapLegend.js     # Map legend overlay
├── pages/
│   ├── Dashboard.jsx    # Main visualization view
│   └── UserUploads.jsx  # Image upload/management
├── DataContext.jsx      # Global state (indicators, WebSocket)
├── api.js               # Axios configuration
├── config.js            # API/media base URLs
└── globals.js           # Shared state variables
```

## Build & Deploy

Production builds are created by the `dashboard-builder` Docker service and served via nginx at `/dashboard/`.

The app uses client-side routing, so all routes serve `index.html` and React Router handles navigation.

## Key Features

- **Table Switching**: Use Shift+Z to switch between `idistrict` and `otef` tables
- **Real-time Sync**: WebSocket keeps all connected clients in sync
- **Presentation Mode**: Automated slide sequencing with pause/play controls
- **Image Caching**: LRU cache for better performance during presentations
