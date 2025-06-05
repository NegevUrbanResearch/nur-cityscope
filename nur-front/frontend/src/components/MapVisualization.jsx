import {
  Box,
  Typography,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
} from "@mui/material";
import React, { useState, useCallback } from "react";
import api from "../api";
import MapIcon from "@mui/icons-material/Map";
import ImageIcon from "@mui/icons-material/Image";
import DeckGLMap from "./maps/DeckGLMap";

const MapVisualization = ({
  error = false,
  mapDataUrl,
  imageUrl,
  currentIndicator,
  data,
  showLoadingMessage,
 
}) => {
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
    
    
    
  if (error) {
      return (
        <>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Error loading visualization: Using fallback map
          </Alert>
          <iframe 
            src={mapDataUrl}
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
            borderRadius: 1,
            "& > div": {
              position: "relative !important",
              height: "100% !important"
            }
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
            {imageUrl && (
              <Box
                component="img"
                src={imageUrl}
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


export default MapVisualization; 
