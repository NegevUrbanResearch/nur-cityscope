# Use Node.js Alpine as the base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all source files
COPY . .

# Set build argument
ARG REACT_APP_MAPBOX_ACCESS_TOKEN
ENV REACT_APP_MAPBOX_ACCESS_TOKEN=$REACT_APP_MAPBOX_ACCESS_TOKEN

# Build the app
RUN npm run build

# Create a script to copy build files and keep container running
RUN echo '#!/bin/sh' > /app/copy-build.sh && \
    echo 'cp -r /app/build/* /app/build-volume/ && tail -f /dev/null' >> /app/copy-build.sh && \
    chmod +x /app/copy-build.sh

# Command to copy build files and keep container running
CMD ["/app/copy-build.sh"]