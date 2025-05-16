import React, { useState, useEffect, useRef } from "react";
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
  const { 
    dashboardData: data, 
    currentIndicator, 
    getIndicatorTitle, 
    getTabLabels 
  } = useAppData();
  const [value, setValue] = React.useState("1");
  const [mapData, setMapData] = useState({
    url: null,
    type: null,
    loading: true,
    error: false
  });
  
  // Refs to track image loading state
  const imageStates = useRef(new Map());
  const [currentImageUrl, setCurrentImageUrl] = useState(null);
  const [showLoadingMessage, setShowLoadingMessage] = useState(true);
  const lastIndicatorRef = useRef(currentIndicator);
  const loadingTimerRef = useRef(null);

  // Fetch map data from API when indicator changes
  useEffect(() => {
    // Clear any existing loading timer
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
    }
    
    // Store a reference to any new timer we create
    let currentLoadingTimer = null;
    
    // When the indicator changes, we don't immediately show loading
    // Only show loading if it takes more than 300ms to load
    if (lastIndicatorRef.current !== currentIndicator) {
      loadingTimerRef.current = setTimeout(() => {
        setShowLoadingMessage(true);
      }, 300);
      currentLoadingTimer = loadingTimerRef.current;
    }

    lastIndicatorRef.current = currentIndicator;
    
    const fetchMapData = async () => {
      try {
        // Add cache-busting timestamp parameter
        const timestamp = Date.now();
        // Use our pre-configured api instance with relative URL
        const response = await api.get(`/api/actions/get_image_data/?_=${timestamp}`);
        
        if (response.data && response.data.image_data) {
          // Correctly construct the URL using config.media.baseUrl
          const url = response.data.image_data.startsWith('/')
            ? `${config.media.baseUrl}${response.data.image_data}?_=${timestamp}`
            : `${config.media.baseUrl}/media/${response.data.image_data}?_=${timestamp}`;
            
          setMapData({
            url,
            type: response.data.type || 'map',
            loading: false,
            error: false
          });
          
          // If this URL hasn't been loaded before, preload it now
          if (!imageStates.current.has(url)) {
            preloadImage(url);
          } else if (imageStates.current.get(url) === 'loaded') {
            // Image is already loaded, set it as current immediately
            setCurrentImageUrl(url);
            setShowLoadingMessage(false);
          }
        }
      } catch (err) {
        console.error("Error fetching map data:", err);
        
        // Fallback to default map based on indicator if API fails
        const timestamp = Date.now();
        const fallbackUrl = `${config.media.baseUrl}/media/maps/${currentIndicator}_2023.html?_=${timestamp}`;
        
        setMapData({
          url: fallbackUrl,
          type: 'map',
          loading: false,
          error: true,
          errorMessage: err.message
        });
        setShowLoadingMessage(false);
      }
    };

    if (currentIndicator) {
      fetchMapData();
    }
    
    return () => {
      // Use our local reference to the timer
      if (currentLoadingTimer) {
        clearTimeout(currentLoadingTimer);
      }
    };
  }, [currentIndicator]);

  // Preload image and track its loading state
  const preloadImage = (url) => {
    // Mark this URL as loading
    imageStates.current.set(url, 'loading');
    
    const img = new Image();
    img.onload = () => {
      // Mark as loaded and update state to show this image
      imageStates.current.set(url, 'loaded');
      setCurrentImageUrl(url);
      setShowLoadingMessage(false);
      
      // Clear any pending loading timer
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    };
    
    img.onerror = () => {
      // Mark as error but still show it (will use fallback in the render method)
      imageStates.current.set(url, 'error');
      setCurrentImageUrl(url);
      setShowLoadingMessage(false);
      
      // Clear any pending loading timer
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    };
    
    img.src = url;
  };

  const handleChange = (event, newValue) => {
    setValue(newValue);
  };

  // Get dashboard title directly from the context helper
  const getDashboardTitle = () => getIndicatorTitle();

  // Handle map or image rendering
  const renderVisualization = () => {
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
        <Box sx={{ height: "100%", width: "100%" }}>
          {/* Only show loading message after delay (if still loading) */}
          {showLoadingMessage && (
            <Box sx={{ 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              height: '100%' 
            }}>
              <Typography variant="body1">
                Loading visualization...
              </Typography>
            </Box>
          )}
          
          {/* Always render the current image when available */}
          {currentImageUrl && (
            <Box
              component="img"
              src={currentImageUrl}
              alt={`${currentIndicator} visualization`}
              sx={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: showLoadingMessage ? 'none' : 'block'
              }}
              onError={(e) => {
                console.error("Failed to load image:", e);
                // Add cache-busting to fallback image
                e.target.src = `/media/Nur-Logo_3x-_1_.svg?_=${Date.now()}`;
              }}
            />
          )}
        </Box>
      );
    }
    
    // Default to map (iframe)
    const timestamp = Date.now();
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
          // Try the other naming pattern as fallback with cache busting
          e.target.src = `${config.media.baseUrl}/media/maps/map_${currentIndicator}.html?_=${timestamp}`;
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

  // Get tab labels directly from the context helper
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