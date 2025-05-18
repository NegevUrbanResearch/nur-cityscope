import React, { useState, useEffect, useRef, useCallback } from "react";
import { Tab, Box, AppBar, Typography, Grid, Paper, Alert, ToggleButtonGroup, ToggleButton } from "@mui/material";
import { TabPanel, TabContext, TabList } from "@mui/lab";
import isEqual from "lodash/isEqual";
import api from "../api";
import MapIcon from '@mui/icons-material/Map';
import ImageIcon from '@mui/icons-material/Image';

import RadarChart from "../components/RadarChart";
import PieChart from "../components/PieChart";
import BarChart from "../components/BarChart";
import HorizontalStackedBar from "../components/HorizontalStackedBar";
import DeckGLMap from "../components/maps/DeckGLMap";
import { useAppData } from "../DataContext";
import config from "../config";

// Memoize components to avoid unnecessary re-renders
const MemoizedRadarChart = React.memo(RadarChart, (prevProps, nextProps) =>
  isEqual(prevProps.data, nextProps.data)
);
const MemoizedPieChart = React.memo(PieChart);
const MemoizedBarChart = React.memo(BarChart, (prevProps, nextProps) =>
  isEqual(prevProps.data, nextProps.data)
);
const MemoizedHorizontalStackedBar = React.memo(
  HorizontalStackedBar,
  (prevProps, nextProps) => isEqual(prevProps.data, nextProps.data)
);

const TabComponent = () => {
  const { 
    dashboardData: data,
    getTabLabels
    
  } = useAppData();
  const [value, setValue] = React.useState("1");
 
  const tabLabels = getTabLabels();
  
  const handleChange = (event, newValue) => {
    setValue(newValue);
  };


  return (
    <Paper sx={{ padding: 2, margin: 1, height: "100%", backgroundColor: "#252530", color: "white" }} elevation={4}>
              <TabContext value={value}>
                <Box
                  sx={{
                    borderBottom: 1,
                    borderColor: "rgba(255,255,255,0.1)",
                    width: "100%",
                    bgcolor: "#252530",
                  }}
                >
                  <TabList 
                    onChange={handleChange} 
                    centered
                    sx={{ 
                      '& .MuiTab-root': { color: 'rgba(255,255,255,0.7)' },
                      '& .Mui-selected': { color: '#fff' },
                      '& .MuiTabs-indicator': { backgroundColor: '#4cc9c0' }
                    }}
                  >
                    <Tab label={tabLabels[0]} value="1" />
                    <Tab label={tabLabels[1]} value="2" />
                    <Tab label={tabLabels[2]} value="3" />
                    <Tab label={tabLabels[3]} value="4" />
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
  );
};

export default TabComponent; 