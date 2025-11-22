import React, { useEffect,useCallback } from "react";
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
import { useAppData } from "./DataContext";
import "./style/index.css";

// Wrapper component to handle indicator from URL params
const DashboardWrapper = ({ openCharts, isPresentationMode, togglePresentationMode }) => {
  const { indicator } = useParams();
  const { changeIndicator, currentIndicator } = useAppData();
  // Set the indicator based on URL when component mounts
  useEffect(() => {
    if (indicator && indicator !== currentIndicator) {
      changeIndicator(indicator);
    }
  }, [indicator, changeIndicator, currentIndicator]);
  return <Dashboard openCharts={openCharts} isPresentationMode={isPresentationMode} togglePresentationMode={togglePresentationMode} />;
};

const App = () => {

  const { loading, error, changeIndicator, currentIndicator } = useAppData();
  const navigate = useNavigate(); 
  const location = useLocation();
  
  const remoteControlActive = React.useRef(false);

  const [openCharts, setOpenCharts] = React.useState(true);
  const [isPresentationMode, setIsPresentationMode] = React.useState(false);
  const isPresentationModeRef = React.useRef(isPresentationMode);

  useEffect(() => {
      isPresentationModeRef.current = isPresentationMode;
  }, [isPresentationMode]);

  const togglePresentationMode = useCallback((isEntering) => {
      setIsPresentationMode(isEntering);
      console.log(`[Local Toggle] Presentation Mode: ${isEntering}`);
  }, []);

  const handleChartsClick = () => {
    setOpenCharts(!openCharts);
  };

  // Keep track of the last indicator the remote set
  const lastRemoteIndicator = React.useRef(null);

    // Helper to extract indicator from path
    const getIndicatorFromPath = useCallback((path) => {
    if (path.includes("/mobility")) return "mobility";
    if (path.includes("/climate")) return "climate";
    if (path.includes("/presentation")) return "presentation";
    return null;
  }, []);

  // Monitor if remote controller has activated
  React.useEffect(() => {
    // If currentIndicator doesn't match URL path, remote controller must be active
    const pathIndicator = getIndicatorFromPath(location.pathname);

    if (pathIndicator && pathIndicator !== currentIndicator && pathIndicator !== 'presentation') {
      console.log("Remote controller is active");
      remoteControlActive.current = true;
      lastRemoteIndicator.current = currentIndicator;
    }

    if (isPresentationMode && pathIndicator !== 'presentation' && pathIndicator !== currentIndicator) {
        console.log("Remote indicator override detected. Exiting local Presentation Mode.");
        togglePresentationMode(false);
    }

  }, [currentIndicator, location.pathname, isPresentationMode, togglePresentationMode, getIndicatorFromPath]);


  React.useEffect(() => {
    if (isPresentationMode) return;

    const pathIndicator = getIndicatorFromPath(location.pathname);
    if (currentIndicator && pathIndicator !== currentIndicator){
      console.log(`Context changed to '${currentIndicator}'. Navigating to sync URL.`);
      if (currentIndicator !== 'presentation') {
         navigate(`/${currentIndicator}`, { replace: true }); 
      }
    }
  },  [currentIndicator, location.pathname, navigate, getIndicatorFromPath, isPresentationMode]);

   useEffect(() => {
    const pathIndicator = getIndicatorFromPath(location.pathname);
    const isModeActive = isPresentationModeRef.current;

    if (pathIndicator === 'presentation') {
        if (!isModeActive) {
            console.log("URL became /presentation. Setting local state.");
            togglePresentationMode(true);
        }
    }
  }, [location.pathname, togglePresentationMode, getIndicatorFromPath]);


  React.useEffect(() => {
    // Skip this if remote controller is active
    if (remoteControlActive.current) return;
    
    const pathIndicator = getIndicatorFromPath(location.pathname);
    const isModeActive = isPresentationModeRef.current;

     if (pathIndicator && pathIndicator !== currentIndicator && pathIndicator !== 'presentation') {
      changeIndicator(pathIndicator);
      if (isModeActive) {
           togglePresentationMode(false);
       }
      }
    },[location.pathname, changeIndicator, currentIndicator, togglePresentationMode, getIndicatorFromPath]);

 
  React.useEffect(() => {
    const pathIndicator = getIndicatorFromPath(location.pathname);
    
    if (isPresentationMode && pathIndicator !== 'presentation') {
        console.log("Presentation Mode active, routing to /presentation.");
        navigate("/presentation", { replace: true }); 
    } else if (!isPresentationMode && pathIndicator === 'presentation') {
        console.log(`Exiting Presentation Mode. Routing to /${currentIndicator}.`);
        navigate(`/${currentIndicator}`, { replace: true });
    }
  }, [isPresentationMode, currentIndicator, location.pathname, navigate, getIndicatorFromPath]);

  
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

        <Navbar openCharts={openCharts} handleChartsClick={handleChartsClick} togglePresentationMode={togglePresentationMode}  isPresentationMode={isPresentationMode}/>

        <main>
          {loading ? (
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
              {/* Route for Presentation Mode (Front Only) */}
              <Route
                path="presentation"
                element={<DashboardWrapper openCharts={openCharts} 
                        isPresentationMode={isPresentationMode} 
                        togglePresentationMode={togglePresentationMode} />}
              />
              {/* Add specific routes for each indicator */}
              <Route
                path="mobility"
                element={<DashboardWrapper openCharts={openCharts} 
                        isPresentationMode={isPresentationMode} 
                        togglePresentationMode={togglePresentationMode} />}
              />
              <Route
                path="climate"
                element={<DashboardWrapper openCharts={openCharts} 
                        isPresentationMode={isPresentationMode} 
                        togglePresentationMode={togglePresentationMode} />}
              />

              {/* Generic indicator route */}
              <Route
                path=":indicator"
                element={<DashboardWrapper openCharts={openCharts} 
                        isPresentationMode={isPresentationMode} 
                        togglePresentationMode={togglePresentationMode} />}
              />

              {/* Default route redirects to mobility */}
              <Route path="/" element={<Navigate to="mobility" replace />} />

              {/* Catch-all route */}
              <Route path="*" element={<Navigate to="mobility" replace />} />
            </Routes>
          )}
        </main>
      </Box>
    </ThemeProvider>
  );
};

export default App;
