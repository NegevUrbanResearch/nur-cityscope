import React, { useState, useEffect } from "react";
import RadarChart from "./components/RadarChart";
import PieChart from "./components/PieChart";
import BarChart from "./components/BarChart.js";
import HorizontalStackedBar from "./components/HorizontalStackedBar";
import "./index.css";
import axios from "axios";
import isEqual from "lodash/isEqual";
import config from "./config";
import PublicIcon from "@mui/icons-material/Public";
import {
  Tab,
  Box,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
  ListItemText,
  ListItemButton,
  ListItem,
  Divider,
  ListItemIcon,
  CssBaseline,
  Grid,
  Paper,
} from "@mui/material";
import { TabPanel, TabContext, TabList } from "@mui/lab";

// Memoize components to avoid unnecessary re-renders
const MemoizedRadarChart = React.memo(RadarChart, (prevProps, nextProps) =>
  isEqual(prevProps.data, nextProps.data),
);
const MemoizedPieChart = React.memo(PieChart);
const MemoizedBarChart = React.memo(BarChart, (prevProps, nextProps) =>
  isEqual(prevProps.data, nextProps.data),
);
const MemoizedHorizontalStackedBar = React.memo(
  HorizontalStackedBar,
  (prevProps, nextProps) => isEqual(prevProps.data, nextProps.data),
);
const App = () => {
  const [value, setValue] = React.useState(0);

  const handleChange = (event, newValue) => {
    setValue(newValue);
  };

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    const apiUrl = config.api.getDashboardFeedUrl();
    console.log("Attempting to fetch data from:", apiUrl);

    let isMounted = true;
    let intervalId;
    let isFetching = false;

    const fetchData = async () => {
      if (isFetching) {
        console.log("Previous fetch still in progress, skipping...");
        return;
      }

      try {
        console.log("Starting data fetch from:", apiUrl);
        isFetching = true;
        const response = await axios.get(apiUrl);
        console.log("Received response from:", apiUrl);
        console.log("Response status:", response.status);
        console.log("Response data:", response.data);

        if (!isMounted) return;

        // Transform the data to match the expected format
        const transformedData = {
          // Direct mapping for radar chart - it expects categories, valuesSet1, valuesSet2
          radar: response.data[0].data.radar,

          // Direct mapping for horizontal stacked bar chart - it expects bars with name and values
          horizontalStackedBars: response.data[0].data.horizontalStackedBar,

          // Direct mapping for stacked bar chart - it expects bars with name and values
          stackedBars: response.data[0].data.stackedBar,

          // Pie chart data transformation
          pieChart: {
            labels: ["Green Space", "Other"],
            datasets: [
              {
                data: [
                  response.data[0].data.green_space_percentage,
                  100 - response.data[0].data.green_space_percentage,
                ],
                backgroundColor: [
                  config.charts.colors.secondary,
                  config.charts.colors.tertiary,
                ],
              },
            ],
          },
        };

        console.log("Transformed data:", transformedData);
        setData(transformedData);
        setLastUpdate(new Date().toLocaleString());
        setError(null);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching data from:", apiUrl);
        console.error("Error details:", err.message);
        if (err.response) {
          console.error("Response status:", err.response.status);
          console.error("Response data:", err.response.data);
        }
        if (isMounted) {
          setError(err.message);
        }
      } finally {
        isFetching = false;
      }
    };

    // Initial fetch
    fetchData();

    // Set up polling interval
    intervalId = setInterval(fetchData, config.polling.interval);
    console.log(
      `Set up polling interval of ${config.polling.interval / 1000} seconds`,
    );

    return () => {
      console.log("Cleaning up...");
      isMounted = false;
      if (intervalId) {
        clearInterval(intervalId);
        console.log("Cleared polling interval");
      }
    };
  }, []);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          backgroundColor: "#1a1a1a",
          color: "white",
          fontSize: "1.2em",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            width: "50px",
            height: "50px",
            border: "5px solid #f3f3f3",
            borderTop: "5px solid #3498db",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            marginBottom: "20px",
          }}
        />
        <div>Loading data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          backgroundColor: "#1a1a1a",
          color: "#ff4444",
          fontSize: "1.2em",
          flexDirection: "column",
        }}
      >
        <div>Error loading data: {error}</div>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: "20px",
            padding: "10px 20px",
            backgroundColor: "#3498db",
            color: "white",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        height: "100vh",
        flexGrow: 1,
        bgcolor: "background.default",
        p: 3,
      }}
    >
      <CssBaseline />
      <AppBar position="fixed">
        <Toolbar
          sx={{
            width: "85vw",
            mr: "15vw",
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="h6" noWrap component="div">
            map1
          </Typography>
          <Typography variant="h6" noWrap component="div">
            Last update: {lastUpdate ? lastUpdate : "N/A"}
          </Typography>
        </Toolbar>
      </AppBar>
      <Box
        component="main"
        sx={{ flexGrow: 1, bgcolor: "background.default", p: 3 }}
      >
        <Toolbar />
        <Grid
          container
          direction="column"
          sx={{
            justifyContent: "center",
            alignItems: "center",
          }}
          spacing={2}
        >
          <Grid item>
            <Typography variant="h5" component="div" gutterBottom>
              {config.frontend.title}
            </Typography>
          </Grid>
          <Grid item size="8" width={"80%"} height={"60vh"}>
            <Paper sx={{ padding: 2, margin: 1, height: "100%" }} elevation={3}>
              interactive map will be displayed here
            </Paper>
          </Grid>

          <Grid item size="4">
            <TabContext value={value}>
              <Box
                sx={{
                  borderBottom: 1,
                  borderColor: "divider",
                  width: "100%",
                  bgcolor: "background.paper",
                }}
              >
                <TabList onChange={handleChange} centered>
                  <Tab label="Proximity" value="1" />
                  <Tab label="Density" value="2" />
                  <Tab label="Radar Chart" value="3" />
                  <Tab label="Land Use" value="4" />
                </TabList>
              </Box>
              <TabPanel value="1">
                <MemoizedHorizontalStackedBar
                  data={data?.horizontalStackedBars}
                />
              </TabPanel>
              <TabPanel value="2">
                <MemoizedBarChart data={data?.stackedBars} />
              </TabPanel>
              <TabPanel value="3">
                <MemoizedRadarChart data={data?.radar} />
              </TabPanel>
              <TabPanel value="4">
                <MemoizedPieChart data={data?.pieChart} />
              </TabPanel>
            </TabContext>
          </Grid>
        </Grid>
      </Box>

      <Drawer
        sx={{
          width: "15vw",
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: "15vw",
          },
        }}
        variant="permanent"
        anchor="right"
      >
        <center>
          <Typography variant="h5" component="div">
            logo here
            {/* <img
                  src={config.frontend.logo.url}
                  alt="CityLab Biobío"
                  style={{ width: config.frontend.logo.width }}
                /> */}
          </Typography>
        </center>
        <Divider />

        <List>
          {/* currently the navigation isn't working */}
          <ListItem key="map_1" disablePadding>
            <ListItemButton>
              <ListItemIcon>
                <PublicIcon />
              </ListItemIcon>
              <ListItemText primary="map1" />
            </ListItemButton>
          </ListItem>
          <ListItem key="map_2" disablePadding>
            <ListItemButton>
              <ListItemIcon>
                <PublicIcon />
              </ListItemIcon>
              <ListItemText primary="map2" />
            </ListItemButton>
          </ListItem>
          <ListItem key="map_3" disablePadding>
            <ListItemButton>
              <ListItemIcon>
                <PublicIcon />
              </ListItemIcon>
              <ListItemText primary="map3" />
            </ListItemButton>
          </ListItem>
          <ListItem key="map_4" disablePadding>
            <ListItemButton>
              <ListItemIcon>
                <PublicIcon />
              </ListItemIcon>
              <ListItemText primary="map4" />
            </ListItemButton>
          </ListItem>
        </List>
        <Divider />
        <List>{/* can add different list items if needed */}</List>
      </Drawer>
    </Box>
  );
};

export default App;
