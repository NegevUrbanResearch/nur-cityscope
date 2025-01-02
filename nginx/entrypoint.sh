# nginx/entrypoint.sh
#!/bin/sh

# Reemplazar variables de entorno en la plantilla de configuración
envsubst '${API_PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# Iniciar Nginx
exec nginx -g 'daemon off;'
