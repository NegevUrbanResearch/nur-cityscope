import React, { useState, useEffect, useRef, useCallback } from "react";
import {  Box, AppBar, Typography, Grid, Paper } from "@mui/material";
import api from "../api";
import TabComponent from "../components/TabComponent";
import { useAppData } from "../DataContext";
import config from "../config";
import MapVisualization from "../components/MapVisualization";
import MetricDisplay from "../components/MetricDisplay";


const Dashboard = () => {
  const { dashboardData: data, currentIndicator,getIndicatorTitle} = useAppData();
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
    // Ensure scrolling is enabled
    document.body.style.overflow = 'auto';
    document.body.style.backgroundColor = '#111116';
    document.documentElement.style.height = '100%';
    
    return () => {
      // Clean up styles when component unmounts
      document.body.style.margin = '';
      document.body.style.padding = '';
      document.body.style.overflow = '';
      document.body.style.backgroundColor = '';
      document.documentElement.style.height = '';
    };
  }, []);

  // Get dashboard title directly from the context helper
  const getDashboardTitle = () => getIndicatorTitle();

  return (
    <AppBar position="static" sx={{ backgroundColor: "#111116", maxHeight: "none", overflow: "auto" }}>
      <Box sx={{ flexGrow: 1, bgcolor: "#1a1a22", p: 2, color: "white", height: "auto", minHeight: "100vh", overflow: "visible" }}>
        <Grid container direction="column"  spacing={2} sx={{ justifyContent: "center", alignItems: "center",}} >
          <Grid item>
            <Typography variant="h4" component="div" gutterBottom sx={{ color: "#fff", fontWeight: 300 }}>
              {getDashboardTitle()}
            </Typography>
          </Grid>

          <Grid item>
            <Paper sx={{ padding: 2, margin: 1, backgroundColor: "#252530", color: "white" }} elevation={4}>
              <MetricDisplay data={data} currentIndicator={currentIndicator} />
            </Paper>
          </Grid>

          <Grid item size="8" width={"80%"} height={"40vh"}>
            <Paper elevation={4} sx={{  padding: 2, margin: 1, height: "100%",backgroundColor: "#1a1a22",color: "white" }} >
              <MapVisualization  
                  error={mapData.error} 
                  mapDataUrl={mapData.url} 
                  imageUrl= {currentImageUrl} 
                  currentIndicator = {currentIndicator}
                  data = {data}
                  showLoadingMessage = {showLoadingMessage}
                /> 

            </Paper>
          </Grid>

          <Grid item size="4" width={"80%"}>
            <TabComponent/>
          </Grid>
          
        </Grid>
      </Box>
    </AppBar>
  );
};

export default Dashboard; 