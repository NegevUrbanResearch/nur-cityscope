// Frontend configuration
const config = {
  // API Configuration
  api: {
    // Get the API URL from environment variable or use a default
    baseUrl: process.env.REACT_APP_API_URL || 'http://localhost:9900',
    // API endpoints
    endpoints: {
      dashboardFeed: '/api/dashboard_feed_state/',
    },
    // Get the full URL for the dashboard feed
    getDashboardFeedUrl: () => `${config.api.baseUrl}${config.api.endpoints.dashboardFeed}`,
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
      url: 'https://citylabbiobio.cl/wp-content/uploads/2023/08/logo-CLBB-ch.png',
      width: '200px'
    }
  }
};

export default config; 