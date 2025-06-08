FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source files
COPY . .

# Build the app
RUN npm run build

# Create a script to copy build files to the shared volume
RUN echo '#!/bin/sh' > /app/copy-build.sh && \
    echo 'cp -r /app/build/* /app/build-volume/' >> /app/copy-build.sh && \
    chmod +x /app/copy-build.sh

# Command to copy build files and keep container running
CMD ["sh", "-c", "cp -r /app/build/* /app/build-volume/ && tail -f /dev/null"]