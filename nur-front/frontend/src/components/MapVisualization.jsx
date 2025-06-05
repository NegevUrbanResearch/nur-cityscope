import {
  Box,
  Typography,
  Alert,
  ToggleButtonGroup,
  ToggleButton,
  Grid,
  Dialog,
  AppBar, 
  Toolbar,
  IconButton
} from "@mui/material";
import React, { useState, useCallback } from "react";
import api from "../api";
import MapIcon from "@mui/icons-material/Map";
import ImageIcon from "@mui/icons-material/Image";
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CloseIcon from '@mui/icons-material/Close';
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
  const [visualizationMode, setVisualizationMode] = useState("deck");
  const [open, setOpen] = React.useState(false);

  const handleVisualizationModeChange = useCallback((event, newMode) => {
    if (newMode !== null) {
      setVisualizationMode(newMode);

      // Optionally update the backend visualization mode
      api
        .post("/api/actions/set_visualization_mode/", {
          mode: newMode === "deck" ? "map" : "image",
        })
        .catch((err) => {
          console.error("Error setting visualization mode:", err);
        });
    }
  }, []);

  if (error) {
    return (
      <>
        <Box sx={{ height: "100%", width: "100%" }}>
          <Typography
            variant="h6"
            sx={{ color: "#fff" }}>
            Interactive Map
          </Typography>

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
  
  const handleClickOpen = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
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
      <Grid container sx={{ justifyContent: "space-between" }} >
        <Typography variant="h6" sx={{ color: "#fff" }}>
          Interactive Map
        </Typography>
        <Grid >
        <ToggleButtonGroup value={visualizationMode} exclusive onChange={handleVisualizationModeChange} size="small" aria-label="visualization mode">
            <ToggleButton value="deck" aria-label="interactive map">
                <MapIcon fontSize="small" />
                <Typography variant="caption" sx={{ ml: 1 }}>
                    Interactive
                </Typography>
            </ToggleButton>
            <ToggleButton value="image" aria-label="static image">
                <ImageIcon fontSize="small" />
                <Typography variant="caption" sx={{ ml: 1 }}>
                     Image
                </Typography>
            </ToggleButton>
            <ToggleButton value="deck" sx={{ ml: 1 }} onClick={handleClickOpen} selected={false}>
                <OpenInFullIcon fontSize="small" />
            </ToggleButton>        
        </ToggleButtonGroup>
        </Grid>
      </Grid>
      
      <Box sx={{ height: "90%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center",backgroundColor: "#111116",borderRadius: 1,overflow: "hidden",border: "1px solid rgba(255,255,255,0.1)"}}>
        {visualizationMode === "deck" ? 
        ( // Show interactive Deck.GL map when in deck mode 
        <DeckGLMap 
        indicatorType={currentIndicator}
        state={state}
        />
        ) : (
        // Show traditional image/iframe view
        <>
        { showLoadingMessage && (  // Only show loading message after delay (if still loading) 
         <Box sx={{ display: "flex",height: "100%"}}>
            <Typography variant="body1">Loading visualization...</Typography>
        </Box>
        )}
        { imageUrl && (  // Always render the current image when available 
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
      
      
      
      <Dialog fullScreen open={open} onClose={handleClose}>
        <AppBar position="fixed">
            <Toolbar sx={{ justifyContent: "space-between",alignItems: "center",}}>
                <IconButton onClick={handleClose} aria-label="close"   sx={{ ml: 1 }}   >
                    <CloseIcon fontSize="small" />
                </IconButton>
                <ToggleButtonGroup value={visualizationMode} exclusive onChange={handleVisualizationModeChange} size="small" aria-label="visualization mode">
                    <ToggleButton value="deck" aria-label="interactive map">
                        <MapIcon fontSize="small" />
                        <Typography variant="caption" sx={{ ml: 1 }}>
                            Interactive
                        </Typography>
                    </ToggleButton>
                    <ToggleButton value="image" aria-label="static image" >
                        <ImageIcon fontSize="small" />
                        <Typography variant="caption" sx={{ ml: 1 }}>
                            Image
                         </Typography>
                    </ToggleButton>  
                </ToggleButtonGroup> 
            </Toolbar>
        </AppBar>
        <Box  sx={{ mt: '76px',  height: "calc(100vh - 76px)"  }}>
        {visualizationMode === "deck" ? 
        ( // Show interactive Deck.GL map when in deck mode 
        <DeckGLMap 
        indicatorType={currentIndicator}
        state={state}
        />
        ) : (
        // Show traditional image/iframe view
        <>
        { showLoadingMessage && (  // Only show loading message after delay (if still loading) 
         <Box sx={{ display: "flex",height: "100%"}}>
            <Typography variant="body1">Loading visualization...</Typography>
        </Box>
        )}
        { imageUrl && (  // Always render the current image when available 
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
      </Dialog>
      
      
    </Box>
  );
};

export default MapVisualization;
