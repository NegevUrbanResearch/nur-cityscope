import React, { useEffect, useCallback, useRef, useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
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
import UserUploads from "./pages/UserUploads";
import { useAppData } from "./DataContext";
import { setupGlobalErrorHandlers } from "./utils/errorLogger";
import "./style/index.css";

// Wrapper component to render Dashboard with URL params
// Note: URL → Context syncing is handled by App's useEffect, not here,
// to avoid race conditions when navigating between indicators
const DashboardWrapper = ({ openCharts }) => {
  return <Dashboard openCharts={openCharts} />;
};

const App = () => {
  const navigate = useNavigate(); 
  const location = useLocation();
  
  // Set up global error handlers on mount
  useEffect(() => {
    setupGlobalErrorHandlers();
  }, []);
  
  const { 
    loading, 
    error, 
    changeIndicator, 
    currentIndicator, 
    isPresentationMode
  } = useAppData();

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
    if (path.includes("/user-uploads")) return "user-uploads";
    return null;
  }, []);

  // Track navigation target to prevent race conditions
  const navigationTargetRef = useRef(null);

  // Effect: Sync Context -> URL (only when not in presentation mode or special routes)
  // This effect handles when context changes and we need to update the URL
  useEffect(() => {
    if (isPresentationMode) return; 

    const pathIndicator = getIndicatorFromPath(location.pathname);
    // Skip syncing for special routes (presentation, user-uploads)
    if (pathIndicator === 'presentation' || pathIndicator === 'user-uploads') {
      return;
    }
    
    if (currentIndicator && pathIndicator !== currentIndicator && pathIndicator !== 'presentation' && pathIndicator !== 'user-uploads') {
      console.log(`Context changed to '${currentIndicator}'. Navigating to sync URL.`);
      // Set navigation target BEFORE navigating to guard against URL->Context sync
      navigationTargetRef.current = currentIndicator;
      navigate(`/${currentIndicator}`, { replace: true });
    }
  }, [currentIndicator, location.pathname, navigate, getIndicatorFromPath, isPresentationMode]);

  // Effect: Sync URL -> Context (for non-presentation and non-special routes)
  // This effect handles when URL changes (e.g., user clicks browser back/forward or navbar)
  useEffect(() => {
    const pathIndicator = getIndicatorFromPath(location.pathname);

    // Skip syncing for special routes (presentation, user-uploads)
    if (pathIndicator === 'presentation' || pathIndicator === 'user-uploads') {
      return;
    }

    // Clear navigation target when URL matches what we were navigating to
    if (navigationTargetRef.current && pathIndicator === navigationTargetRef.current) {
      navigationTargetRef.current = null;
      return; // Navigation completed, no need to sync
    }
    
    // Guard: Don't sync if we're in the middle of a navigation
    if (navigationTargetRef.current) {
      console.log(`⏳ Skipping URL->Context sync: navigation to '${navigationTargetRef.current}' in progress`);
      return;
    }
    
    if (pathIndicator && pathIndicator !== currentIndicator && pathIndicator !== 'presentation' && pathIndicator !== 'user-uploads') {
      console.log(`URL changed to '${pathIndicator}'. Syncing context.`);
      changeIndicator(pathIndicator);
    }
  }, [location.pathname, changeIndicator, currentIndicator, getIndicatorFromPath]);

  // Check if we're in presentation mode (either by state or URL)
  const isInPresentationMode = isPresentationMode || location.pathname.includes('/presentation');
  
  // Don't show navbar in presentation mode or UGC management pages
  const showNavbar = !isInPresentationMode && !location.pathname.includes('/user-uploads');

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
              <Route path="user-uploads" element={<UserUploads />} />
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
