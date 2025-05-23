# nur-CityScope

nur-CityScope is a pipeline for updating cityscope models, originally developed by the CityScience lab in BioBio.

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
DB_CONTAINER_NAME=core_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=nur_db
DATABASE_URL=postgres://postgres:your_secure_password@db:5432/nur_db
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
DATABASE_URL=postgres://postgres:r3@llyStr0ngP@ssw0rd@db:5432/nur_db
```

### Step 3: Start the Services

Start all services with Docker Compose:

```bash
docker-compose up -d
```

This will:
1. Build and start all containers
2. Run the initialization script inside the container which:
   - Waits for the database to be ready
   - Runs database migrations
   - Checks for first-time initialization (using a flag file in `/app/data/db_initialized`)
   - If first-time:
     - Cleans up any existing data
     - Creates sample data
     - Creates a default admin user
   - Starts the Django server

To check if all services are running:
```bash
docker-compose ps
```

To view logs:
```bash
docker-compose logs -f
```

### Step 4: Access the Application

Once everything is running, you should be able to access different parts of the application:

1. **Main Dashboard** ([http://localhost/dashboard/](http://localhost/dashboard/)):
   - Shows key metrics and charts
   - Displays population density, green space coverage, and building height data
   - Updates in real-time with the latest data

2. **Projection Interface** ([http://localhost/projection/](http://localhost/projection/)):
   - Interactive map visualization
   - Shows geographic data and spatial analysis
   - Features:
     - Multiple layer support
     - Layer opacity controls
     - Geographic data visualization
     - Real-time updates
     - Custom layer configurations

3. **Remote Controller** ([http://localhost/remote/](http://localhost/remote/)):
   - Control interface for managing map layers and states
   - Features:
     - Layer selection buttons for different indicators
     - State control buttons (P-1 through P-7) for toggling different states
     - Reset buttons for quick state management:
       - ACTUAL: Resets all states to 0
       - FUTURE: Sets all states to 1
     - Real-time state updates
     - Visual feedback with glowing/neon button effects
     - Start/Stop controls for the projection system

4. **Admin Interface** ([http://localhost:9900/admin](http://localhost:9900/admin)):
   - Manage indicators, states, and configurations
   - Create and modify users
   - View and edit all data

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

## Data Management

### Data Structure

The application uses the following data models to organize information:

1. **Map Types** - Define different map visualization modes
2. **Indicators** - Define measurable urban metrics (population density, green space, etc.)
3. **States** - Define different time periods/scenarios (present, future projections)
4. **Indicator Data** - Link indicators with their states
5. **Indicator GeoJSON** - Store geographic data for visualization
6. **Layer Config** - Define how layers are displayed (colors, opacity)
7. **Dashboard Feed State** - Store current dashboard metrics

For detailed information about each model and its fields, see the [Documentation](DOCUMENTATION.md).

### Managing Data

You can manage your data through:

1. **Admin Interface** ([http://localhost:9900/admin](http://localhost:9900/admin))
   - Manage indicators, states, and configurations
   - Create and modify users
   - View and edit all data

2. **Remote Controller** ([http://localhost/remote/](http://localhost/remote/))
   - Control map layers and states in real-time
   - Toggle between different indicators
   - Manage projection states
   - Start/Stop the projection system

3. **API Endpoints** ([http://localhost:9900/api/](http://localhost:9900/api/))
   - Programmatically interact with the data
   - Create, read, update, and delete records
   - Access all data models through RESTful endpoints

### Data Validation

When adding new data, ensure:

1. **GeoJSON Data**
   - Valid GeoJSON format
   - Coordinates in correct range
   - Required properties included
   - Reasonable value ranges

2. **Layer Configuration**
   - Valid color codes (hex format)
   - Opacity between 0 and 1
   - Proper legend configuration

3. **Dashboard Feed State**
   - All required metrics included
   - Values within reasonable ranges
   - Proper timestamp format

## API Documentation

For complete API documentation, see:
- **Interactive Documentation**: [http://localhost:9900/swagger/](http://localhost:9900/swagger/)
- **Data Documentation**: [DATA-DOC.md](DATA-DOC.md)
