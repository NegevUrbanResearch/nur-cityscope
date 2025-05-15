import axios from 'axios';
import config from './config';

// Create a pre-configured axios instance
const api = axios.create({
  // Use the origin by default (allows relative URLs to work correctly)
  baseURL: config.api.baseUrl,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  }
});

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