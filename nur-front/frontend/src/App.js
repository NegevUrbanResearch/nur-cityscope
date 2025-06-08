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
  Toolbar,
  IconButton,
  Drawer,
  Divider,
  Grid,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";

import darkTheme from "./theme";
import {
  Main,
  AppBar,
  DrawerHeader,
  drawerWidth,
} from "./style/styled_components/DrawerComponents";
import Navbar from "./components/Navbar";
import Dashboard from "./pages/Dashboard";
import { useAppData } from "./DataContext";
import "./style/index.css";

// Wrapper component to handle indicator from URL params
const DashboardWrapper = () => {
  const { indicator } = useParams();
  const { changeIndicator, currentIndicator } = useAppData();
  // Set the indicator based on URL when component mounts
  useEffect(() => {
    if (indicator && indicator !== currentIndicator) {
      changeIndicator(indicator);
    }
  }, [indicator, changeIndicator, currentIndicator]);
  return <Dashboard />;
};

const App = () => {
  const { loading, error, changeIndicator, currentIndicator } = useAppData();
  const location = useLocation();
  const remoteControlActive = React.useRef(false);

  const [openMenu, setOpenMenu] = React.useState(false);
  const [openCharts, setOpenCharts] = React.useState(false);

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
    if (path.includes("/land_use")) return "land_use";
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

  const handleMenuClick = () => {
    setOpenMenu(!openMenu);
  };
  const handleChartsClick = () => {
    setOpenCharts(!openCharts);
  };

  return (
    <ThemeProvider theme={darkTheme}>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          overflow: "auto",
          position: "relative",
          display: "flex",
          mt: "76px",
          height: "calc(100vh - 76px)", // 76px is the navbar height
        }}>
        <CssBaseline />
        <AppBar
          position="fixed"
          openMenu={openMenu}
          openCharts={openCharts}>
          <Toolbar>
            <Grid
              container
              width="100%"
              justifyContent="space-between">
              <Grid item>
                <IconButton
                  onClick={handleMenuClick}
                  sx={[
                    {
                      mr: 2,
                    },
                    openMenu && { display: "none" },
                  ]}>
                  <MenuIcon />
                </IconButton>
              </Grid>
              <Grid item>
                <Typography
                  variant="h6"
                  noWrap
                  component="div"
                  sx={{ flexGrow: 1 }}>
                  title
                </Typography>
              </Grid>
              <Grid item>
                <IconButton
                  edge="end"
                  onClick={handleChartsClick}
                  sx={[openCharts && { display: "none" }]}>
                  <MenuIcon />
                </IconButton>
              </Grid>
            </Grid>
          </Toolbar>
        </AppBar>
        <Drawer
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              boxSizing: "border-box",
            },
          }}
          variant="persistent"
          anchor="left"
          open={openMenu}>
          <DrawerHeader>
            <IconButton onClick={handleMenuClick}>
              <ChevronLeftIcon />
            </IconButton>
          </DrawerHeader>
          <Divider />
          menu will be here
        </Drawer>
        <Main
          openMenu={openMenu}
          openCharts={openCharts}>
          <DrawerHeader />
          {loading ? (
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                height: "100%",
              }}>
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
              }}>
              <Typography
                variant="h6"
                color="error"
                gutterBottom>
                Error loading application data
              </Typography>
              <Typography
                variant="body1"
                gutterBottom
                paragraph>
                {error}
              </Typography>
              <Button
                variant="contained"
                color="primary"
                onClick={() => window.location.reload()}>
                Retry
              </Button>
            </Box>
          ) : (
            <Routes>
              {/* Add specific routes for each indicator */}
              <Route
                path="mobility"
                element={<DashboardWrapper />}
              />
              <Route
                path="climate"
                element={<DashboardWrapper />}
              />
              <Route
                path="land_use"
                element={<DashboardWrapper />}
              />

              {/* Generic indicator route */}
              <Route
                path=":indicator"
                element={<DashboardWrapper />}
              />

              {/* Default route redirects to mobility */}
              <Route
                path="/"
                element={
                  <Navigate
                    to="mobility"
                    replace
                  />
                }
              />

              {/* Catch-all route */}
              <Route
                path="*"
                element={
                  <Navigate
                    to="mobility"
                    replace
                  />
                }
              />
            </Routes>
          )}
        </Main>
        <Drawer
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            "& .MuiDrawer-paper": {
              width: drawerWidth,
            },
          }}
          variant="persistent"
          anchor="right"
          open={openCharts}>
          <DrawerHeader>
            <IconButton onClick={handleChartsClick}>
              <ChevronLeftIcon />
            </IconButton>
          </DrawerHeader>
          <Divider />
          charts will be here
        </Drawer>
      </Box>
    </ThemeProvider>
  );
};

export default App;
