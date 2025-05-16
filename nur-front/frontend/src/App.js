import React from "react";
import "./style/index.css";
import {
  Box,
  CssBaseline,
  ThemeProvider,
  CircularProgress,
  Typography,
  Button,
} from "@mui/material";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";

import darkTheme from "./theme";
import { useAppData } from "./DataContext";

import Navbar from "./components/Navbar";
import Dashboard from "./pages/Dashboard";

const App = () => {
  const { loading, error, changeIndicator, currentIndicator } = useAppData();
  const location = useLocation();
  const remoteControlActive = React.useRef(false);
  
  // Keep track of the last indicator the remote set
  const lastRemoteIndicator = React.useRef(null);

  // Monitor if remote controller has activated
  React.useEffect(() => {
    // If currentIndicator doesn't match URL path, remote controller must be active
    const pathIndicator = getIndicatorFromPath(location.pathname);
    if (pathIndicator && pathIndicator !== currentIndicator) {
      console.log('Remote controller is active');
      remoteControlActive.current = true;
      lastRemoteIndicator.current = currentIndicator;
    }
  }, [currentIndicator, location.pathname]);

  // Helper to extract indicator from path
  const getIndicatorFromPath = (path) => {
    if (path.includes('/mobility')) return 'mobility';
    if (path.includes('/climate')) return 'climate';
    if (path.includes('/land_use')) return 'land_use';
    return null;
  };
  
  // Update the current indicator based on the route, but only if remote controller isn't active
  React.useEffect(() => {
    // Skip this if remote controller is active
    if (remoteControlActive.current) {
      return;
    }

    const pathIndicator = getIndicatorFromPath(location.pathname);
    if (pathIndicator && pathIndicator !== currentIndicator) {
      changeIndicator(pathIndicator);
    }
  }, [location.pathname, changeIndicator, currentIndicator]);

  if (loading) {
    return (
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        flexDirection: 'column',
        gap: 2
      }}>
        <CircularProgress size={60} />
        <Typography variant="h6">Loading dashboard data...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        flexDirection: 'column',
        gap: 2
      }}>
        <Typography variant="h5" color="error">Error loading data</Typography>
        <Typography>{error}</Typography>
        <Button variant="contained" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <ThemeProvider theme={darkTheme}>
        <CssBaseline />
        <Navbar />

        <Box component="main" sx={{ mt: 8, p: 3 }}>
          <Routes>
            {/* Default route redirects to the current indicator */}
            <Route path="/" element={<Navigate to={`/dashboard/${currentIndicator}`} replace />} />
            <Route path="/dashboard" element={<Navigate to={`/dashboard/${currentIndicator}`} replace />} />
            
            {/* All dashboard routes use the same Dashboard component */}
            <Route path="/dashboard/mobility" element={<Dashboard />} />
            <Route path="/dashboard/climate" element={<Dashboard />} />
            <Route path="/dashboard/land_use" element={<Dashboard />} />
            
            {/* Fallback for unknown routes */}
            <Route path="*" element={<Navigate to={`/dashboard/${currentIndicator}`} replace />} />
          </Routes>
        </Box>
      </ThemeProvider>
    </Box>
  );
};

export default App;
