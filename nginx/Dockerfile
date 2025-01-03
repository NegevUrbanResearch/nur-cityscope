# Usar una imagen ligera basada en Alpine
FROM nginx:alpine

# Instalar gettext para usar envsubst
RUN apk add --no-cache gettext

# Copiar la plantilla de configuración de Nginx
COPY default.conf.template /etc/nginx/templates/default.conf.template

# Copiar el script de entrada
COPY entrypoint.sh /entrypoint.sh

# Convertir el script al formato Unix (en caso de que venga de Windows)
RUN sed -i 's/\r$//' /entrypoint.sh
# RUN sed -i 's/\r$//' /etc/nginx/templates/default.conf.template

# Hacer que el script de entrada sea ejecutable
RUN chmod +x entrypoint.sh

# Exponer el puerto 80 para tráfico HTTP
EXPOSE 80

# Usar el script de entrada para inicializar el contenedor
CMD ["./entrypoint.sh"]
