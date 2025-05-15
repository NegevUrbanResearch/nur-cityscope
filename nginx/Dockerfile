# Use a lightweight Alpine-based image
FROM nginx:alpine

# Install gettext for envsubst and other necessary tools
RUN apk add --no-cache gettext

# Copy the Nginx configuration template
COPY default.conf.template /etc/nginx/templates/default.conf.template

# Copy the entrypoint script
COPY entrypoint.sh /entrypoint.sh

# Convert scripts to Unix format (in case they come from Windows)
RUN sed -i 's/\r$//' /entrypoint.sh
# RUN sed -i 's/\r$//' /etc/nginx/templates/default.conf.template

# Make the entrypoint script executable
RUN chmod +x /entrypoint.sh

# Create necessary directories with proper permissions
RUN mkdir -p /var/cache/nginx/ /var/run/nginx/ && \
    chmod -R 777 /var/cache/nginx/ /var/run/nginx/ && \
    mkdir -p /usr/share/nginx/html/media && \
    chmod -R 755 /usr/share/nginx/html/

# Expose port 80 for HTTP traffic
EXPOSE 80

# Use the entrypoint script to initialize the container
CMD ["./entrypoint.sh"]
