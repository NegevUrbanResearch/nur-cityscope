import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, AppBar, Typography, Grid, Paper, Alert } from "@mui/material";
import api from "../api";
import TabComponent from "../components/TabComponent";
import { useAppData } from "../DataContext";
import config from "../config";
import MetricDisplay from "../components/MetricDisplay";
import DeckGLMap from "../components/maps/DeckGLMap";

const Dashboard = () => {
  const {
    dashboardData: data,
    currentIndicator,
    getIndicatorTitle,
  } = useAppData();
  const [mapData, setMapData] = useState({
    url: null,
    type: null,
    loading: true,
    error: false,
  });

  // Refs to track image loading state
  const imageStates = useRef(new Map());
  const [currentImageUrl, setCurrentImageUrl] = useState(null);
  const [showLoadingMessage, setShowLoadingMessage] = useState(true);
  const lastIndicatorRef = useRef(currentIndicator);
  const loadingTimerRef = useRef(null);
  const { visualizationMode } = useAppData();

  // Preload image and track its loading state - memoize to avoid dependency issues
  const preloadImage = useCallback(
    (url) => {
      // First clear any previous loading state for this URL
      imageStates.current.delete(url);

      // Mark this URL as loading
      imageStates.current.set(url, "loading");

      const img = new Image();
      img.onload = () => {
        // Only proceed if this is still the current indicator's image
        if (url.includes(currentIndicator)) {
          // Mark as loaded and update state to show this image
          imageStates.current.set(url, "loaded");
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
        imageStates.current.set(url, "error");

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
    },
    [currentIndicator],
  );

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
        const response = await api.get(
          `/api/actions/get_image_data/?_=${timestamp}&indicator=${currentIndicator}`,
        );

        if (response.data && response.data.image_data) {
          // Correctly construct the URL using config.media.baseUrl
          const url = response.data.image_data.startsWith("/")
            ? `${config.media.baseUrl}${response.data.image_data}?_=${timestamp}`
            : `${config.media.baseUrl}/media/${response.data.image_data}?_=${timestamp}`;

          setMapData({
            url,
            type: response.data.type || "map",
            loading: false,
            error: false,
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
          type: "map",
          loading: false,
          error: true,
          errorMessage: err.message,
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
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    // Ensure scrolling is enabled
    document.body.style.overflow = "auto";
    document.body.style.backgroundColor = "#111116";
    document.documentElement.style.height = "100%";

    return () => {
      // Clean up styles when component unmounts
      document.body.style.margin = "";
      document.body.style.padding = "";
      document.body.style.overflow = "";
      document.body.style.backgroundColor = "";
      document.documentElement.style.height = "";
    };
  }, []);

  if (mapData.error) {
    return (
      <>
        <Box sx={{ height: "100%", width: "100%" }}>
          <Alert
            severity="warning"
            sx={{ mb: 2 }}>
            Error loading visualization: Using fallback map
          </Alert>
          <iframe
            src={mapData.url}
            style={{
              width: "100%",
              height: "90%",
              border: "none",
            }}
            title={`${currentIndicator} map visualization`}
            onError={(e) => {
              console.error("Failed to load fallback map:", e);
            }}
          />
        </Box>
      </>
    );
  }

  // Always render DeckGLMap for interactive visualizations
  const state = {
    year: 2023, // Default to 2023
    scenario: "current",
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

  // Get dashboard title directly from the context helper
  const getDashboardTitle = () => getIndicatorTitle();

  return (
    <Box
      sx={{
        width: "99vw",
        marginLeft: "-240px",
        height: "calc(100vh - 64px)",
      }}>
      {visualizationMode === "deck" ? (
        // Show interactive Deck.GL map when in deck mode
        <DeckGLMap
          indicatorType={currentIndicator}
          state={state}
        />
      ) : (
        // Show traditional image/iframe view
        <>
          {showLoadingMessage && ( // Only show loading message after delay (if still loading)
            <Box sx={{ display: "flex", height: "100%" }}>
              <Typography variant="body1">Loading visualization...</Typography>
            </Box>
          )}
          {currentImageUrl && ( // Always render the current image when available
            <Box
              component="img"
              src={currentImageUrl}
              alt={`${currentIndicator} visualization`}
              sx={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: showLoadingMessage ? "none" : "block",
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

export default Dashboard;
