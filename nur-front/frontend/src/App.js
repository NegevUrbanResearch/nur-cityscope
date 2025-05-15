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
  const { loading, error, changeIndicator } = useAppData();
  const location = useLocation();

  // Update the current indicator based on the route
  React.useEffect(() => {
    if (location.pathname === "/dashboard/mobility") {
      changeIndicator("mobility");
    } else if (location.pathname === "/dashboard/climate") {
      changeIndicator("climate");
    } else if (location.pathname === "/dashboard/land_use") {
      changeIndicator("land_use");
    }
  }, [location.pathname, changeIndicator]);

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
            {/* Default route redirects to mobility dashboard */}
            <Route path="/" element={<Navigate to="/dashboard/mobility" replace />} />
            <Route path="/dashboard" element={<Navigate to="/dashboard/mobility" replace />} />
            
            {/* All dashboard routes use the same Dashboard component */}
            <Route path="/dashboard/mobility" element={<Dashboard />} />
            <Route path="/dashboard/climate" element={<Dashboard />} />
            <Route path="/dashboard/land_use" element={<Dashboard />} />
            
            {/* Fallback for unknown routes */}
            <Route path="*" element={<Navigate to="/dashboard/mobility" replace />} />
          </Routes>
        </Box>
      </ThemeProvider>
    </Box>
  );
};

export default App;
