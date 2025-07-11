# nur-CityScope

nur-CityScope is a framework for updating cityscope models

## Project Overview

This project consists of several interconnected repositories:
- **nur-io**: Backend API and core functionality
- **nur-remote-controller**: Remote control interface for managing map layers and states
- **nur-front**: Frontend dashboard
- **nur-projection**: Projection visualization system

## Quick Start Guide

### Prerequisites

- Docker and Docker Compose
- Git

### Step 1: Clone this Repository

```bash
git clone https://github.com/your-username/nur-cityscope.git
cd nur-cityscope
```

### Step 2: Create and Configure .env File

Create a file named `.env` in the project root directory with the following content:

```
DB_CONTAINER_NAME=db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=db
DATABASE_URL=postgres://postgres:postgres@db:5432/db
API_PORT=9900
FRONT_PORT=80
```

**Important:** 
- Replace `your_secure_password` with a strong password
- Use the same password in both the `POSTGRES_PASSWORD` and `DATABASE_URL` lines
- Don't use quotes around values

Example with a password:
```
POSTGRES_PASSWORD=r3@llyStr0ngP@ssw0rd
DATABASE_URL=postgres://postgres:r3@llyStr0ngP@ssw0rd@db:5432/db
```

### Step 3: Start the Services

Start all services with Docker Compose:

```bash
docker-compose up -d
```

To check if all services are running:
```bash
docker-compose ps
```

To view logs:
```bash
docker-compose logs -f
```

To hard reset:
```bash
docker-compose down -v && docker system prune -f && docker-compose up -d --build
```
### Step 4: Access the Application

Once everything is running, you should be able to access different parts of the application:

1. **Main Dashboard** ([http://localhost/dashboard/](http://localhost/dashboard/)):


2. **Projection Interface** ([http://localhost/projection/](http://localhost/projection/)):

3. **Remote Controller** ([http://localhost/remote/](http://localhost/remote/)):

4. **Admin Interface** ([http://localhost:9900/admin](http://localhost:9900/admin)):

5. **API Documentation**:
   - **Django REST API**: [http://localhost:9900/api/](http://localhost:9900/api/) - API root endpoint with browsable interface
   - **Swagger UI**: [http://localhost:9900/swagger/](http://localhost:9900/swagger/) - Interactive API explorer
   - **ReDoc**: [http://localhost:9900/redoc/](http://localhost:9900/redoc/) - Clean, readable API reference
   - **OpenAPI Schema**: [http://localhost:9900/swagger.json](http://localhost:9900/swagger.json) - Raw API schema

### Step 5: Default Admin User

A default admin user is created during setup with the following credentials:
- Username: admin
- Password: admin123

**Important**: Please change the default password after first login!

To change the admin password:
1. Log in to the admin interface
2. Go to the Users section
3. Click on the admin user
4. Change the password

### Managing Data

You can manage your data through:

1. **Admin Interface** ([http://localhost:9900/admin](http://localhost:9900/admin))

2. **API Endpoints** ([http://localhost:9900/api/](http://localhost:9900/api/))
   - Programmatically interact with the data
   - Create, read, update, and delete records
   - Access all data models through RESTful endpoints