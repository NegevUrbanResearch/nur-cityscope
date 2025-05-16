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

// Add response interceptor to help with debugging
api.interceptors.response.use(
  response => {
    return response;
  },
  error => {
    console.error('API request error:', error.message);
    if (error.response) {
      console.error('Error status:', error.response.status);
      console.error('Error data:', error.response.data);
    }
    return Promise.reject(error);
  }
);

export default api; 