# nginx/Dockerfile
FROM nginx:alpine

# Instalar gettext para usar envsubst
RUN apk add --no-cache gettext

# Copiar la plantilla de configuración de Nginx
COPY default.conf.template /etc/nginx/templates/default.conf.template

# Copiar el script de entrada
COPY entrypoint.sh /entrypoint.sh

# Hacer el script ejecutable
RUN chmod +x /entrypoint.sh

# Exponer el puerto 80
EXPOSE 80

# Definir el script de entrada
CMD ["./entrypoint.sh"]
