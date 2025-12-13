import axios from 'axios';
import config from './config';

// Create a pre-configured axios instance
const api = axios.create({
  // Use the origin by default (allows relative URLs to work correctly)
  baseURL: config.api.baseUrl,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  }
});

// Add request interceptor to add cache-busting parameter to all GET requests
api.interceptors.request.use(
  config => {
    if (config.method === 'get') {
      // Add timestamp parameter to prevent caching
      config.params = {
        ...config.params,
        _: Date.now()
      };
    }
    return config;
  },
  error => {
    return Promise.reject(error);
  }
);

// Endpoints that may have transient 404s during state transitions (will be retried)
const TRANSIENT_404_ENDPOINTS = [
  '/api/actions/get_deckgl_data/',
  '/api/actions/get_image_data/',
];

// Add response interceptor to help with debugging
api.interceptors.response.use(
  response => {
    return response;
  },
  error => {
    // Check if this is a transient 404 that will be retried
    const is404 = error.response?.status === 404;
    const url = error.config?.url || '';
    const isTransient = TRANSIENT_404_ENDPOINTS.some(endpoint => url.includes(endpoint));
    
    // Only log non-transient errors or non-404 errors
    if (!is404 || !isTransient) {
      console.error('API request error:', error.message);
      if (error.response) {
        console.error('Error status:', error.response.status);
        console.error('Error data:', error.response.data);
      }
    }
    // For transient 404s, just log a brief message
    else {
      console.log(`Transient 404 on ${url.split('?')[0]} - will retry`);
    }
    
    return Promise.reject(error);
  }
);

export default api; 