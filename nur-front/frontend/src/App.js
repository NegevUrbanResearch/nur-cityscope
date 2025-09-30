import React, { useEffect } from "react";
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useParams,
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
const DashboardWrapper = ({ openCharts }) => {
  const { indicator } = useParams();
  const { changeIndicator, currentIndicator } = useAppData();
  // Set the indicator based on URL when component mounts
  useEffect(() => {
    if (indicator && indicator !== currentIndicator) {
      changeIndicator(indicator);
    }
  }, [indicator, changeIndicator, currentIndicator]);
  return <Dashboard openCharts={openCharts} />;
};

const App = () => {
  const { loading, error, changeIndicator, currentIndicator } = useAppData();
  const location = useLocation();
  const remoteControlActive = React.useRef(false);

  const [openCharts, setOpenCharts] = React.useState(true);

  const handleChartsClick = () => {
    setOpenCharts(!openCharts);
  };

  // Keep track of the last indicator the remote set
  const lastRemoteIndicator = React.useRef(null);

  // Monitor if remote controller has activated
  React.useEffect(() => {
    // If currentIndicator doesn't match URL path, remote controller must be active
    const pathIndicator = getIndicatorFromPath(location.pathname);
    if (pathIndicator && pathIndicator !== currentIndicator) {
      console.log("Remote controller is active");
      remoteControlActive.current = true;
      lastRemoteIndicator.current = currentIndicator;
    }
  }, [currentIndicator, location.pathname]);

  // Helper to extract indicator from path
  const getIndicatorFromPath = (path) => {
    if (path.includes("/mobility")) return "mobility";
    if (path.includes("/climate")) return "climate";
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

        <Navbar openCharts={openCharts} handleChartsClick={handleChartsClick} />

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
              {/* Add specific routes for each indicator */}
              <Route
                path="mobility"
                element={<DashboardWrapper openCharts={openCharts} />}
              />
              <Route
                path="climate"
                element={<DashboardWrapper openCharts={openCharts} />}
              />

              {/* Generic indicator route */}
              <Route
                path=":indicator"
                element={<DashboardWrapper openCharts={openCharts} />}
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
