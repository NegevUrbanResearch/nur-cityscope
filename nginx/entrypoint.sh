#!/bin/sh
set -e

# Using sudo because we may not be running as root
if [ -f /etc/nginx/conf.d/default.conf ]; then
  rm -f /etc/nginx/conf.d/default.conf
fi

# Ensure proper permissions on media directories
mkdir -p /usr/share/nginx/html/media/indicators
mkdir -p /usr/share/nginx/html/media/maps
chmod -R 755 /usr/share/nginx/html/media

# Process environment variables in the configuration template
envsubst '${API_PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# Start Nginx
exec nginx -g 'daemon off;'