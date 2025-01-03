#!/bin/sh
rm -rf /etc/nginx/conf.d/default.conf

envsubst '${API_PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# Iniciar Nginx
exec nginx -g 'daemon off;'