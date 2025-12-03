import React, { useEffect,useCallback,useRef , useState} from "react";
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
const DashboardWrapper = ({ openCharts  }) => {
  const { indicator } = useParams();
  const { changeIndicator, currentIndicator } = useAppData();
  // Set the indicator based on URL when component mounts
  useEffect(() => {
    if (indicator && indicator !== currentIndicator && indicator !== 'presentation') {
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
      isPresentationMode, 
      togglePresentationMode 
  } = useAppData();
  
  const isPresentationModeRef = useRef(isPresentationMode);
  
  useEffect(() => {
      isPresentationModeRef.current = isPresentationMode;
  }, [isPresentationMode]);

  const remoteControlActive = useRef(false);
  const lastRemoteIndicator = useRef(null);
  const [openCharts, setOpenCharts] = useState(true);

  const handleChartsClick = () => {
    setOpenCharts(!openCharts);
  };

  const getIndicatorFromPath = useCallback((path) => {
    if (path.includes("/mobility")) return "mobility";
    if (path.includes("/climate")) return "climate";
    if (path.includes("/presentation")) return "presentation";
    return null;
  }, []);


  // Effect 0: Monitor remote control
  useEffect(() => {
    const pathIndicator = getIndicatorFromPath(location.pathname);
    
    if (pathIndicator && pathIndicator !== currentIndicator && pathIndicator !== 'presentation') {
      console.log("Remote controller is active");
      remoteControlActive.current = true;
      lastRemoteIndicator.current = currentIndicator;
    }
  }, [currentIndicator, location.pathname, getIndicatorFromPath]);

  // Effect 1: Sync Context -> URL
  useEffect(() => {
    if (isPresentationMode) return; 

    const pathIndicator = getIndicatorFromPath(location.pathname);
    if (currentIndicator && pathIndicator !== currentIndicator){
      console.log(`Context changed to '${currentIndicator}'. Navigating to sync URL.`);
      if (currentIndicator !== 'presentation') {
         navigate(`/${currentIndicator}`, { replace: true }); 
      }
    }
  }, [currentIndicator, location.pathname, navigate, getIndicatorFromPath, isPresentationMode]);

  // Effect 2: Sync URL -> Context
  useEffect(() => {
    if (remoteControlActive.current) return;

    const pathIndicator = getIndicatorFromPath(location.pathname);
    
    if (pathIndicator && pathIndicator !== currentIndicator) {
       if (pathIndicator === 'presentation') {
           if (!isPresentationModeRef.current) {
               console.log("URL is /presentation. Setting context state.");
               togglePresentationMode(true);
           }
       } else {
           changeIndicator(pathIndicator);
           if (isPresentationModeRef.current) {
               togglePresentationMode(false);
           }
       }
    }
  }, [location.pathname, changeIndicator, currentIndicator, togglePresentationMode, getIndicatorFromPath]);

  // Effect 3: Handle Presentation Mode URL Management
  useEffect(() => {
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

        <Navbar 
            openCharts={openCharts} 
            handleChartsClick={handleChartsClick} 
        />

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
              <Route path="presentation" element={<DashboardWrapper openCharts={openCharts} />} />
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
