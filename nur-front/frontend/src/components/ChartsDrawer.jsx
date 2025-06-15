import React from "react";

import {
  IconButton,
  Drawer,
  Divider,
  Grid,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import MapIcon from "@mui/icons-material/Map";
import ImageIcon from "@mui/icons-material/Image";
import { useAppData } from "../DataContext";

import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import TabComponent from "./TabComponent";

const ChartsDrawer = ({ handleChartsClick, openCharts }) => {
  const { visualizationMode, handleVisualizationModeChange } = useAppData();

  return (
    <Drawer
      sx={{
        width: "240px",
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: "240px",
        },
      }}
      variant="persistent"
      anchor="right"
      open={openCharts}>
      <Grid
        container
        sx={{ height: "64px", width: "100%" }}>
        <IconButton
          onClick={handleChartsClick}
          sx={{ backgroundColor: "transparent" }}>
          <ChevronRightIcon />
        </IconButton>
      </Grid>
      <Divider />
      <Grid
        container
        direction="row"
        sx={{ justifyContent: "space-between" }}>
        <Grid
          item
          container>
          <ToggleButtonGroup
            value={visualizationMode}
            exclusive
            onChange={handleVisualizationModeChange}
            size="small"
            aria-label="visualization mode">
            <ToggleButton
              value="deck"
              aria-label="interactive map">
              <MapIcon fontSize="small" />
              <Typography
                variant="caption"
                sx={{ ml: 1 }}>
                Interactive
              </Typography>
            </ToggleButton>
            <ToggleButton
              value="image"
              aria-label="static image">
              <ImageIcon fontSize="small" />
              <Typography
                variant="caption"
                sx={{ ml: 1 }}>
                Image
              </Typography>
            </ToggleButton>
          </ToggleButtonGroup>
        </Grid>
        <Grid
          item
          container>
          {/* <TabComponent /> */}
          <Grid item>chart a</Grid>
          <Grid item>chart b</Grid>
          <Grid item>chart c</Grid>
        </Grid>
      </Grid>
    </Drawer>
  );
};

export default ChartsDrawer;
