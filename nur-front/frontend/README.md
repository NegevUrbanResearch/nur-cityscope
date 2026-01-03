# nur-CityScope Frontend

React dashboard for urban planning visualization with interactive maps and charts.

## Stack

- React 18 + React Router
- Material UI 7
- Deck.gl + Mapbox GL
- Chart.js + Recharts
- WebSocket for real-time updates

## Features

- **Dashboard**: Main visualization with indicator switching (mobility/climate)
- **Presentation Mode**: Full-screen slideshow with automated sequencing
- **User Uploads**: Image management with categories
- **Charts Drawer**: Collapsible panel with indicator-specific visualizations

## Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/mobility` | Dashboard | Mobility visualizations (default) |
| `/climate` | Dashboard | Climate scenario comparisons |
| `/presentation` | PresentationMode | Full-screen slideshow |
| `/user-uploads` | UserUploads | Image management |

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
│   ├── drawer/          # ChartsDrawer, indicator-specific graph panels
│   ├── maps/            # DeckGLMap component
│   ├── Navbar.jsx       # Navigation with indicator switching
│   └── MapLegend.js     # Map legend overlay
├── pages/
│   ├── Dashboard.jsx    # Main visualization view
│   ├── PresentationMode.jsx  # Slideshow with sequence control
│   └── UserUploads.jsx  # Image upload/management
├── DataContext.jsx      # Global state (indicators, uploads, WebSocket)
├── api.js               # Axios configuration
├── config.js            # API/media base URLs
└── globals.js           # Shared state variables
```

## Build

Production builds are created by the `dashboard-builder` Docker service and served via nginx at `/dashboard/`.
