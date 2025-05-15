import React, { useState, useEffect } from "react";
import { Tab, Box, AppBar, Typography, Grid, Paper, Alert } from "@mui/material";
import { TabPanel, TabContext, TabList } from "@mui/lab";
import isEqual from "lodash/isEqual";
import api from "../api";

import RadarChart from "../components/RadarChart";
import PieChart from "../components/PieChart";
import BarChart from "../components/BarChart";
import HorizontalStackedBar from "../components/HorizontalStackedBar";
import { useAppData } from "../DataContext";
import config from "../config";

// Memoize components to avoid unnecessary re-renders
const MemoizedRadarChart = React.memo(RadarChart, (prevProps, nextProps) =>
  isEqual(prevProps.data, nextProps.data)
);
const MemoizedPieChart = React.memo(PieChart);
const MemoizedBarChart = React.memo(BarChart, (prevProps, nextProps) =>
  isEqual(prevProps.data, nextProps.data)
);
const MemoizedHorizontalStackedBar = React.memo(
  HorizontalStackedBar,
  (prevProps, nextProps) => isEqual(prevProps.data, nextProps.data)
);

const Dashboard = () => {
  const { dashboardData: data, currentIndicator } = useAppData();
  const [value, setValue] = React.useState("1");
  const [mapData, setMapData] = useState({
    url: null,
    type: null,
    loading: true,
    error: false
  });

  // Fetch map data from API when indicator changes
  useEffect(() => {
    const fetchMapData = async () => {
      setMapData(prev => ({ ...prev, loading: true, error: false }));
      
      try {
        // Use our pre-configured api instance with relative URL
        const response = await api.get('/api/actions/get_image_data/');
        
        if (response.data && response.data.image_data) {
          // Correctly construct the URL using config.media.baseUrl
          const url = response.data.image_data.startsWith('/')
            ? `${config.media.baseUrl}${response.data.image_data}`
            : `${config.media.baseUrl}/media/${response.data.image_data}`;
            
          setMapData({
            url,
            type: response.data.type || 'map',
            loading: false,
            error: false
          });
          
          // Debug the URL construction
          console.log('Media URL:', url);
          console.log('Media Base URL:', config.media.baseUrl);
          console.log('Image data:', response.data.image_data);
        }
      } catch (err) {
        console.error("Error fetching map data:", err);
        
        // Fallback to default map based on indicator if API fails
        const fallbackUrl = `${config.media.baseUrl}/media/maps/${currentIndicator}_2023.html`;
        
        setMapData({
          url: fallbackUrl,
          type: 'map',
          loading: false,
          error: true,
          errorMessage: err.message
        });
      }
    };

    if (currentIndicator) {
      fetchMapData();
    }
  }, [currentIndicator]);

  const handleChange = (event, newValue) => {
    setValue(newValue);
  };

  // Get dashboard-specific titles and metrics based on the current indicator
  const getDashboardTitle = () => {
    switch (currentIndicator) {
      case 'mobility':
        return "Mobility Dashboard";
      case 'climate':
        return "Climate Dashboard";
      case 'land_use':
        return "Land Use Dashboard";
      default:
        return "Dashboard";
    }
  };

  // Handle map or image rendering
  const renderVisualization = () => {
    if (mapData.loading) {
      return (
        <Typography variant="body1">
          Loading visualization...
        </Typography>
      );
    }
    
    if (mapData.error) {
      return (
        <>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Error loading visualization: Using fallback map
          </Alert>
          <iframe 
            src={mapData.url}
            style={{
              width: "100%",
              height: "90%",
              border: "none"
            }}
            title={`${currentIndicator} map visualization`}
            onError={(e) => {
              console.error("Failed to load fallback map:", e);
            }}
          />
        </>
      );
    }
    
    if (mapData.type === 'image') {
      return (
        <Box
          component="img"
          src={mapData.url}
          alt={`${currentIndicator} visualization`}
          sx={{
            width: "100%",
            height: "100%",
            objectFit: "contain"
          }}
          onError={(e) => {
            console.error("Failed to load image:", e);
            e.target.src = '/media/Nur-Logo_3x-_1_.svg'; // Fallback image
          }}
        />
      );
    }
    
    // Default to map (iframe)
    return (
      <iframe 
        src={mapData.url}
        style={{
          width: "100%",
          height: "90%",
          border: "none"
        }}
        title={`${currentIndicator} map visualization`}
        onError={(e) => {
          console.error("Failed to load map:", e);
          // Try the other naming pattern as fallback
          e.target.src = `${config.media.baseUrl}/media/maps/map_${currentIndicator}.html`;
        }}
      />
    );
  };

  const getMetricDisplay = () => {
    if (!data || !data.metrics) return null;
    
    const metrics = data.metrics;
    
    switch (currentIndicator) {
      case 'mobility':
        return (
          <>
            <Typography variant="body1">Population: {metrics.total_population?.toLocaleString()}</Typography>
            <Typography variant="body1">Public Transport Coverage: {metrics.public_transport_coverage}%</Typography>
            <Typography variant="body1">Average Commute Time: {metrics.average_commute_time} min</Typography>
            <Typography variant="body1">Bike Lane Coverage: {metrics.bike_lane_coverage}%</Typography>
          </>
        );
      case 'climate':
        return (
          <>
            <Typography variant="body1">Population: {metrics.total_population?.toLocaleString()}</Typography>
            <Typography variant="body1">Air Quality Index: {metrics.air_quality_index}</Typography>
            <Typography variant="body1">Carbon Emissions: {metrics.carbon_emissions?.toLocaleString()} tons</Typography>
            <Typography variant="body1">Renewable Energy: {metrics.renewable_energy_percentage}%</Typography>
            <Typography variant="body1">Green Space: {metrics.green_space_percentage}%</Typography>
          </>
        );
      case 'land_use':
        return (
          <>
            <Typography variant="body1">Population: {metrics.total_population?.toLocaleString()}</Typography>
            <Typography variant="body1">Mixed Use Ratio: {metrics.mixed_use_ratio}%</Typography>
            <Typography variant="body1">Population Density: {metrics.population_density} people/km²</Typography>
            <Typography variant="body1">Public Space: {metrics.public_space_percentage}%</Typography>
            <Typography variant="body1">Avg Building Height: {metrics.average_building_height} m</Typography>
          </>
        );
      default:
        return null;
    }
  };

  // Get tab labels based on indicator type
  const getTabLabels = () => {
    switch (currentIndicator) {
      case 'mobility':
        return ["Accessibility", "Modal Split", "Radar Analysis", "Coverage"];
      case 'climate':
        return ["Emissions", "Green Space", "Radar Analysis", "Sustainability"];
      case 'land_use':
        return ["Density", "Land Use Mix", "Radar Analysis", "Building Types"];
      default:
        return ["Tab 1", "Tab 2", "Tab 3", "Tab 4"];
    }
  };

  const tabLabels = getTabLabels();

  return (
    <AppBar position="static">
      <Box sx={{ flexGrow: 1, bgcolor: "background.default", p: 2 }}>
        <Grid
          container
          direction="column"
          sx={{
            justifyContent: "center",
            alignItems: "center",
          }}
          spacing={2}
        >
          <Grid item>
            <Typography variant="h4" component="div" gutterBottom>
              {getDashboardTitle()}
            </Typography>
          </Grid>

          <Grid item>
            <Paper sx={{ padding: 2, margin: 1 }} elevation={3}>
              {getMetricDisplay()}
            </Paper>
          </Grid>

          <Grid item size="8" width={"80%"} height={"40vh"}>
            <Paper sx={{ padding: 2, margin: 1, height: "100%" }} elevation={3}>
              <Typography variant="h6">Interactive Map</Typography>
              <Box 
                sx={{ 
                  height: "90%", 
                  width: "100%", 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center",
                  backgroundColor: "rgba(0,0,0,0.1)",
                  borderRadius: 1,
                  overflow: "hidden"
                }}
              >
                {renderVisualization()}
              </Box>
            </Paper>
          </Grid>

          <Grid item size="4" width={"80%"}>
            <Paper sx={{ padding: 2, margin: 1, height: "100%" }} elevation={3}>
              <TabContext value={value}>
                <Box
                  sx={{
                    borderBottom: 1,
                    borderColor: "divider",
                    width: "100%",
                    bgcolor: "background.paper",
                  }}
                >
                  <TabList onChange={handleChange} centered>
                    <Tab label={tabLabels[0]} value="1" />
                    <Tab label={tabLabels[1]} value="2" />
                    <Tab label={tabLabels[2]} value="3" />
                    <Tab label={tabLabels[3]} value="4" />
                  </TabList>
                </Box>
                <TabPanel value="1">
                  <MemoizedHorizontalStackedBar
                    data={data?.horizontalStackedBars}
                  />
                </TabPanel>
                <TabPanel value="2">
                  <MemoizedBarChart data={data?.stackedBars} />
                </TabPanel>
                <TabPanel value="3">
                  <MemoizedRadarChart data={data?.radar} />
                </TabPanel>
                <TabPanel value="4">
                  <MemoizedPieChart data={data?.pieChart} />
                </TabPanel>
              </TabContext>
            </Paper>
          </Grid>
        </Grid>
      </Box>
    </AppBar>
  );
};

export default Dashboard; 