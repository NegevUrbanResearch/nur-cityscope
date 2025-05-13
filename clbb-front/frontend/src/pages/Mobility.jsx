import React from "react";
import { Tab, Box, AppBar, Typography, Grid, Paper } from "@mui/material";
import { TabPanel, TabContext, TabList } from "@mui/lab";
import isEqual from "lodash/isEqual";

import config from "../config.js";
import RadarChart from "../components/RadarChart.js";
import PieChart from "../components/PieChart.js";
import BarChart from "../components/BarChart.js";
import HorizontalStackedBar from "../components/HorizontalStackedBar.js";
import { useAppData } from "../DataContext.jsx";

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

const Mobility = () => {
  const { map1data: data } = useAppData();
  const [value, setValue] = React.useState("1");

  const handleChange = (event, newValue) => {
    setValue(newValue);
  };

  return (
    <AppBar position="static">
      <Box sx={{ flexGrow: 1, bgcolor: "background.default" }}>
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
            <Paper sx={{ padding: 2, margin: 1, height: "100%" }} elevation={3}>
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
            </Paper>
          </Grid>
        </Grid>
      </Box>
    </AppBar>
  );
};

export default Mobility;
