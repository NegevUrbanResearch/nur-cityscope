import React, { useEffect, useCallback, useRef, useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useParams,
  useNavigate
} from "react-router-dom";
import {
  Box,
  CssBaseline,
  ThemeProvider,
  CircularProgress,
  Typography,
  Button,
} from "@mui/material";

import darkTheme from "./theme";
import Navbar from "./components/Navbar";
import Dashboard from "./pages/Dashboard";
import PresentationMode from "./pages/PresentationMode";
import { useAppData } from "./DataContext";
import "./style/index.css";

// Wrapper component to handle indicator from URL params
const DashboardWrapper = ({ openCharts }) => {
  const { indicator } = useParams();
  const { changeIndicator, currentIndicator } = useAppData();
  
  useEffect(() => {
    if (indicator && indicator !== currentIndicator) {
      changeIndicator(indicator);
    }
  }, [indicator, changeIndicator, currentIndicator]);
  
  return <Dashboard openCharts={openCharts} />;
};

const App = () => {
  const navigate = useNavigate(); 
  const location = useLocation();
  
  const { 
    loading, 
    error, 
    changeIndicator, 
    currentIndicator, 
    isPresentationMode
  } = useAppData();

  const remoteControlActive = useRef(false);
  const [openCharts, setOpenCharts] = useState(true);
  const prevOpenChartsRef = useRef(openCharts);

  const handleChartsClick = () => {
    setOpenCharts(!openCharts);
  };

  // Save drawer state when entering presentation mode
  useEffect(() => {
    if (isPresentationMode) {
      prevOpenChartsRef.current = openCharts;
    }
  }, [isPresentationMode, openCharts]);

  // Restore drawer state when exiting presentation mode
  useEffect(() => {
    if (!isPresentationMode && !location.pathname.includes('/presentation')) {
      // Restore the drawer state
      setOpenCharts(prevOpenChartsRef.current);
    }
  }, [isPresentationMode, location.pathname]);

  const getIndicatorFromPath = useCallback((path) => {
    if (path.includes("/mobility")) return "mobility";
    if (path.includes("/climate")) return "climate";
    if (path.includes("/presentation")) return "presentation";
    return null;
  }, []);

  // Effect: Monitor remote control
  useEffect(() => {
    const pathIndicator = getIndicatorFromPath(location.pathname);
    
    if (pathIndicator && pathIndicator !== currentIndicator && pathIndicator !== 'presentation') {
      console.log("Remote controller is active");
      remoteControlActive.current = true;
    }
  }, [currentIndicator, location.pathname, getIndicatorFromPath]);

  // Effect: Sync Context -> URL (only when not in presentation mode)
  useEffect(() => {
    if (isPresentationMode) return; 

    const pathIndicator = getIndicatorFromPath(location.pathname);
    if (currentIndicator && pathIndicator !== currentIndicator && pathIndicator !== 'presentation') {
      console.log(`Context changed to '${currentIndicator}'. Navigating to sync URL.`);
      navigate(`/${currentIndicator}`, { replace: true }); 
    }
  }, [currentIndicator, location.pathname, navigate, getIndicatorFromPath, isPresentationMode]);

  // Effect: Sync URL -> Context (for non-presentation routes)
  useEffect(() => {
    if (remoteControlActive.current) return;

    const pathIndicator = getIndicatorFromPath(location.pathname);
    
    if (pathIndicator && pathIndicator !== currentIndicator && pathIndicator !== 'presentation') {
      changeIndicator(pathIndicator);
    }
  }, [location.pathname, changeIndicator, currentIndicator, getIndicatorFromPath]);

  // Check if we're in presentation mode (either by state or URL)
  const isInPresentationMode = isPresentationMode || location.pathname.includes('/presentation');
  
  // Don't show navbar in presentation mode
  const showNavbar = !isInPresentationMode;

  return (
    <ThemeProvider theme={darkTheme}>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          overflow: "auto",
          position: "relative",
          display: "flex",
          height: "100vh",
        }}
      >
        <CssBaseline />

        {showNavbar && (
          <Navbar 
            openCharts={openCharts} 
            handleChartsClick={handleChartsClick} 
          />
        )}

        <main style={{ flex: 1 }}>
          {loading && !isInPresentationMode ? (
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100%",
              }}
            >
              <CircularProgress />
            </Box>
          ) : error ? (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                height: "100%",
                p: 3,
              }}
            >
              <Typography variant="h6" color="error" gutterBottom>
                Error loading application data
              </Typography>
              <Typography variant="body1" gutterBottom paragraph>
                {error}
              </Typography>
              <Button
                variant="contained"
                color="primary"
                onClick={() => window.location.reload()}
              >
                Retry
              </Button>
            </Box>
          ) : (
            <Routes>
              <Route path="presentation" element={<PresentationMode />} />
              <Route path="mobility" element={<DashboardWrapper openCharts={openCharts} />} />
              <Route path="climate" element={<DashboardWrapper openCharts={openCharts} />} />
              <Route path=":indicator" element={<DashboardWrapper openCharts={openCharts} />} />
              <Route path="/" element={<Navigate to="mobility" replace />} />
              <Route path="*" element={<Navigate to="mobility" replace />} />
            </Routes>
          )}
        </main>
      </Box>
    </ThemeProvider>
  );
};

export default App;
