# Use the official Python image with the desired version
FROM python:3.11-slim

# Set environment variables for Django
ENV PYTHONUNBUFFERED 1

# Create and set the working directory
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

# Make init script executable
RUN chmod +x /app/init.sh

# Set environment variables
ENV PYTHONPATH=/app
ENV DJANGO_SETTINGS_MODULE=backend.settings

EXPOSE 9900

# Start your application using the init script
CMD ["/app/init.sh"]

