# Use the official Python image with the desired version
FROM python:3.10

# Set environment variables for Django
ENV PYTHONUNBUFFERED 1

# Create and set the working directory
WORKDIR /app

# Create a volume for persistent data
VOLUME /app/data

# Install system dependencies
RUN apt-get update && apt-get install -y netcat-traditional && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt /app/
RUN pip install -r requirements.txt

# Copy the project files into the container
COPY . /app/

EXPOSE 9900

# Start your application (you may need to adjust the command)
CMD ["python", "manage.py", "runserver", "0.0.0.0:9900"]

