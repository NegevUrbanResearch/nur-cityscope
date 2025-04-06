# Use the official Python image with the desired version
FROM python:3.9-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Set work directory
WORKDIR /app

# Create a volume for persistent data
VOLUME /app/data

# Install system dependencies
RUN apt-get update && apt-get install -y \
    postgresql-client \
    netcat-traditional \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Create necessary directories
RUN mkdir -p /app/backend/migrations

# Make init scripts executable
RUN chmod +x /app/init.sh
COPY init.bat /app/init.bat

# Set environment variables
ENV PYTHONPATH=/app
ENV DJANGO_SETTINGS_MODULE=backend.settings

EXPOSE 9900

# Create a wrapper script that will choose the appropriate init script
RUN echo '#!/bin/sh\nif [ -f /app/init.sh ]; then\n  /app/init.sh\nelse\n  /app/init.bat\nfi' > /app/init-wrapper.sh && \
    chmod +x /app/init-wrapper.sh

# Start your application using the wrapper script
CMD ["/app/init-wrapper.sh"]

