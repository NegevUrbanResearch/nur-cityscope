import { Box, Typography, Alert } from "@mui/material";
import React from "react";

import DeckGLMap from "./maps/DeckGLMap";
import { useAppData } from "../DataContext";

const MapVisualization = ({
  error = false,
  mapDataUrl,
  imageUrl,
  currentIndicator,
  data,
  showLoadingMessage,
}) => {
  const { visualizationMode } = useAppData();

  //const visualizationMode = "deck";  // fix

  if (error) {
    return (
      <>
        <Box sx={{ height: "100%", width: "100%" }}>
          <Alert
            severity="warning"
            sx={{ mb: 2 }}>
            Error loading visualization: Using fallback map
          </Alert>
          <iframe
            src={mapDataUrl}
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
          {imageUrl && ( // Always render the current image when available
            <Box
              component="img"
              src={imageUrl}
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

export default MapVisualization;
