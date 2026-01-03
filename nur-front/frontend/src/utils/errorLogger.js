/**
 * Frontend Error Logger
 * Sends frontend errors to the backend for centralized logging
 */

import api from '../api';

/**
 * Log an error to the backend console
 * @param {Error|string} error - The error object or error message
 * @param {Object} options - Additional error context
 * @param {string} options.component - Component name where error occurred
 * @param {string} options.type - Error type (e.g., 'API', 'WebSocket', 'Component')
 * @param {Object} options.additionalData - Any additional context data
 */
export const logErrorToBackend = async (error, options = {}) => {
  try {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    
    const errorData = {
      type: options.type || 'Error',
      message: errorMessage,
      stack: errorStack,
      url: window.location.href,
      timestamp: new Date().toISOString(),
      component: options.component || 'Unknown',
      additional_data: options.additionalData || {},
    };

    // Send to backend (fire and forget - don't block on this)
    api.post('/api/actions/log_frontend_error/', errorData).catch(() => {
      // Silently fail if backend logging fails - we don't want to create an error loop
    });
  } catch (err) {
    // Silently fail - we don't want error logging to cause more errors
    console.warn('Failed to log error to backend:', err);
  }
};

/**
 * Set up global error handlers
 */
export const setupGlobalErrorHandlers = () => {
  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    logErrorToBackend(event.reason, {
      type: 'UnhandledPromiseRejection',
      component: 'Global',
    });
  });

  // Catch uncaught errors
  window.addEventListener('error', (event) => {
    logErrorToBackend(event.error || event.message, {
      type: 'UncaughtError',
      component: 'Global',
      additionalData: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });
};

export default logErrorToBackend;

