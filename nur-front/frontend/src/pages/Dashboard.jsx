import React, { useState, useEffect, useRef, useCallback } from "react";
import { Tab, Box, AppBar, Typography, Grid, Paper, Alert, ToggleButtonGroup, ToggleButton } from "@mui/material";
import { TabPanel, TabContext, TabList } from "@mui/lab";
import isEqual from "lodash/isEqual";
import api from "../api";
import MapIcon from '@mui/icons-material/Map';
import ImageIcon from '@mui/icons-material/Image';

import RadarChart from "../components/RadarChart";
import PieChart from "../components/PieChart";
import BarChart from "../components/BarChart";
import HorizontalStackedBar from "../components/HorizontalStackedBar";
import DeckGLMap from "../components/maps/DeckGLMap";
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

  // Preload image and track its loading state - memoize to avoid dependency issues
  const preloadImage = useCallback((url) => {
    // First clear any previous loading state for this URL
    imageStates.current.delete(url);
    
    // Mark this URL as loading
    imageStates.current.set(url, 'loading');
    
    const img = new Image();
    img.onload = () => {
      // Only proceed if this is still the current indicator's image
      if (url.includes(currentIndicator)) {
        // Mark as loaded and update state to show this image
        imageStates.current.set(url, 'loaded');
        setCurrentImageUrl(url);
        setShowLoadingMessage(false);
      }
      
      // Clear any pending loading timer
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    };
    
    img.onerror = () => {
      console.error(`Failed to load image: ${url}`);
      
      // Mark as error but still try to show it
      imageStates.current.set(url, 'error');
      
      // Only update UI if this is still the current indicator's image
      if (url.includes(currentIndicator)) {
        setCurrentImageUrl(url);
        setShowLoadingMessage(false);
      }
      
      // Clear any pending loading timer
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    };
    
    img.src = url;
  }, [currentIndicator]);

  // Fetch map data from API when indicator changes
  useEffect(() => {
    // Clear any existing loading timer
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
    }
    
    // Store a reference to any new timer we create
    let currentLoadingTimer = null;
    
    // When the indicator changes, we should show loading immediately 
    // to prevent showing stale content
    if (lastIndicatorRef.current !== currentIndicator) {
      setShowLoadingMessage(true);
      // Clear the current image URL to prevent showing stale content
      setCurrentImageUrl(null);
    }

    lastIndicatorRef.current = currentIndicator;
    
    const fetchMapData = async () => {
      try {
        // Add cache-busting timestamp parameter
        const timestamp = Date.now();
        // Use our pre-configured api instance with relative URL
        const response = await api.get(`/api/actions/get_image_data/?_=${timestamp}&indicator=${currentIndicator}`);
        
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
          
          // Always preload the new image regardless of previous state
          // This ensures we always have the latest image for the current indicator
          preloadImage(url);
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

    // Add a slight delay to allow the indicator change to propagate through the system
    setTimeout(() => {
      if (currentIndicator) {
        fetchMapData();
      }
    }, 100);
    
    return () => {
      // Use our local reference to the timer
      if (currentLoadingTimer) {
        clearTimeout(currentLoadingTimer);
      }
    };
  }, [currentIndicator, preloadImage]);

  useEffect(() => {
    // Set body and html styling to ensure full viewport coverage
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    // Remove overflow: hidden to enable scrolling
    // document.body.style.overflow = 'hidden';
    document.body.style.backgroundColor = '#111116';
    document.documentElement.style.height = '100%';
    
    return () => {
      // Clean up styles when component unmounts
      document.body.style.margin = '';
      document.body.style.padding = '';
      // document.body.style.overflow = '';
      document.body.style.backgroundColor = '';
      document.documentElement.style.height = '';
    };
  }, []);

  const handleChange = (event, newValue) => {
    setValue(newValue);
  };

  // Get dashboard title directly from the context helper
  const getDashboardTitle = () => getIndicatorTitle();

  // Handle map or image rendering
  const renderVisualization = () => {
    // Add a switch for visualization mode (deck.gl or traditional)
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
    
    // Always render DeckGLMap for interactive visualizations
    const state = {
      year: 2023, // Default to 2023
      scenario: 'current'
    };
    
    // Try to get the state from the lastUpdate or the current indicator's data
    if (data?.metrics) {
      // We derive current year from formatted metrics
      // This assumes that the metrics are updated when the state changes
      if (data.metrics.year) {
        state.year = data.metrics.year;
      }
      if (data.metrics.scenario) {
        state.scenario = data.metrics.scenario;
      }
    }
    
    return (
      <Box sx={{ height: "100%", width: "100%" }}>
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
          <ToggleButtonGroup
            value={visualizationMode}
            exclusive
            onChange={handleVisualizationModeChange}
            size="small"
            aria-label="visualization mode"
          >
            <ToggleButton value="deck" aria-label="interactive map">
              <MapIcon fontSize="small" />
              <Typography variant="caption" sx={{ ml: 1 }}>Interactive</Typography>
            </ToggleButton>
            <ToggleButton value="image" aria-label="static image">
              <ImageIcon fontSize="small" />
              <Typography variant="caption" sx={{ ml: 1 }}>Image</Typography>
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
        
        {/* Show interactive Deck.GL map when in deck mode */}
        {visualizationMode === 'deck' ? (
          <Box sx={{ 
            height: "calc(100% - 40px)", 
            width: "100%", 
            position: "relative",
            overflow: "hidden",
            borderRadius: 1
          }}>
            <DeckGLMap 
              indicatorType={currentIndicator} 
              state={state}
            />
          </Box>
        ) : (
          // Show traditional image/iframe view
          <>
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
          </>
        )}
      </Box>
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

  // Add the following new state and handler to the Dashboard component before the return statement
  const [visualizationMode, setVisualizationMode] = useState('deck');

  const handleVisualizationModeChange = useCallback((event, newMode) => {
    if (newMode !== null) {
      setVisualizationMode(newMode);
      
      // Optionally update the backend visualization mode
      api.post('/api/actions/set_visualization_mode/', { mode: newMode === 'deck' ? 'map' : 'image' })
        .catch(err => {
          console.error('Error setting visualization mode:', err);
        });
    }
  }, []);

  return (
    <AppBar position="static" sx={{ backgroundColor: "#111116", maxHeight: "none", overflow: "auto" }}>
      <Box sx={{ flexGrow: 1, bgcolor: "#1a1a22", p: 2, color: "white", height: "auto", minHeight: "100vh" }}>
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
            <Typography variant="h4" component="div" gutterBottom sx={{ color: "#fff", fontWeight: 300 }}>
              {getDashboardTitle()}
            </Typography>
          </Grid>

          <Grid item>
            <Paper sx={{ padding: 2, margin: 1, backgroundColor: "#252530", color: "white" }} elevation={4}>
              {getMetricDisplay()}
            </Paper>
          </Grid>

          <Grid item size="8" width={"80%"} height={"40vh"}>
            <Paper 
              sx={{ 
                padding: 2, 
                margin: 1, 
                height: "100%",
                backgroundColor: "#1a1a22",
                color: "white"
              }} 
              elevation={4}
            >
              <Typography variant="h6" sx={{ color: "#fff" }}>Interactive Map</Typography>
              <Box 
                sx={{ 
                  height: "90%", 
                  width: "100%", 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center",
                  backgroundColor: "#111116",
                  borderRadius: 1,
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.1)"
                }}
              >
                {renderVisualization()}
              </Box>
            </Paper>
          </Grid>

          <Grid item size="4" width={"80%"}>
            <Paper sx={{ padding: 2, margin: 1, height: "100%", backgroundColor: "#252530", color: "white" }} elevation={4}>
              <TabContext value={value}>
                <Box
                  sx={{
                    borderBottom: 1,
                    borderColor: "rgba(255,255,255,0.1)",
                    width: "100%",
                    bgcolor: "#252530",
                  }}
                >
                  <TabList 
                    onChange={handleChange} 
                    centered
                    sx={{ 
                      '& .MuiTab-root': { color: 'rgba(255,255,255,0.7)' },
                      '& .Mui-selected': { color: '#fff' },
                      '& .MuiTabs-indicator': { backgroundColor: '#4cc9c0' }
                    }}
                  >
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