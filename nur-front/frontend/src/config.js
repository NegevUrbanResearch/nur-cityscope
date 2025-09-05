// Frontend configuration

// Assert required environment variables
const assertRequiredEnvVars = () => {
  const requiredVars = {
    'REACT_APP_MAPBOX_ACCESS_TOKEN': process.env.REACT_APP_MAPBOX_ACCESS_TOKEN
  };

  const missingVars = Object.entries(requiredVars)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

  if (missingVars.length > 0) {
    console.error('Environment variables check failed:', {
      missingVars,
      env: process.env,
      nodeEnv: process.env.NODE_ENV
    });
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}\n` +
      'Please check that your .env file exists and ensure that your mapbox access token is set.'
    );
  }
};

// Only run assertions in production
if (process.env.NODE_ENV === 'production') {
  assertRequiredEnvVars();
}

const config = {
  // API Configuration
  api: {
    // Get the API URL from environment variable or use window.location.origin for relative paths
    baseUrl: process.env.REACT_APP_API_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost'),
    // API endpoints
    endpoints: {
      dashboardFeed: '/api/dashboard_feed_state/',
      climateData: '../public/climate_data/',
    },
    // Get the full URL for the dashboard feed
    getDashboardFeedUrl: () => `${config.api.baseUrl}${config.api.endpoints.dashboardFeed}`,
  },
  
  // Media Configuration - separate from API
  media: {
    // Media files are served by Nginx, use window.location.origin by default
    baseUrl: process.env.REACT_APP_MEDIA_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost'),
  },
  
  // Map Configuration
  map: {
    // Mapbox access token from environment variable with fallback
    accessToken: process.env.REACT_APP_MAPBOX_ACCESS_TOKEN || 'pk.eyJ1Ijoibm9hbWpnYWwiLCJhIjoiY20zbHJ5MzRvMHBxZTJrcW9uZ21pMzMydiJ9.B_aBdP5jxu9nwTm3CoNhlg',
    // Default map style (Carto dark matter)
    defaultStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
  },
  
  // Polling Configuration
  polling: {
    interval: 5000, // 5 seconds
  },
  
  // Chart Configuration
  charts: {
    colors: {
      primary: '#3498db',
      secondary: '#2ecc71',
      tertiary: '#95a5a6',
    },
  },

  // Frontend-specific settings
  frontend: {
    title: 'Dashboard Control Panel',
    logo: {
      url: '/media/Nur-Logo_3x-_1_.svg',
      width: '200px'
    }
  }
};

export default config; 