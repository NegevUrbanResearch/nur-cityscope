import React from "react";
import {
  IconButton,
  Drawer,
  Grid,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Tooltip,
} from "@mui/material";
import MapIcon from "@mui/icons-material/Map";
import ImageIcon from "@mui/icons-material/Image";
import CloseIcon from "@mui/icons-material/Close";
//import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import InfoOutlineIcon from "@mui/icons-material/InfoOutline";

import isEqual from "lodash/isEqual";

import { useAppData } from "../DataContext";
import { chartsDrawerWidth } from "../style/drawersStyles";

import RadarChart from "./charts/RadarChart";
import PieChart from "./charts/PieChart";
import HorizontalStackedBar from "./charts/HorizontalStackedBar";
import StackedBarChart from "./charts/BarChart";
import ChartCard from "./ChartCard";
import NavMenu from "./NavMenu";

const ChartsDrawer = ({ handleChartsClick, openCharts }) => {
  const {
    visualizationMode,
    handleVisualizationModeChange,
    dashboardData: data,
    getTabLabels,
    currentIndicator,
  } = useAppData();

  const tabLabels = getTabLabels();

  let disableInteractiveMode = false;

  if (currentIndicator == "climate") {
    handleVisualizationModeChange(null, "image");
    disableInteractiveMode = true;
  }

  return (
    <Drawer
      sx={{
        width: chartsDrawerWidth,
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: chartsDrawerWidth,
        },
      }}
      variant="persistent"
      anchor="right"
      open={openCharts}>
      <Grid
        container
        sx={{
          justifyContent: "space-between",
          alignItems: "center",
          height: "76px",
          width: "100%",
        }}>
        <IconButton
          onClick={handleChartsClick}
          sx={{ backgroundColor: "transparent" }}>
          <CloseIcon />
        </IconButton>

        <NavMenu />

        <IconButton sx={{ backgroundColor: "transparent" }}>
          <InfoOutlineIcon />
        </IconButton>
      </Grid>

      <Grid
        container
        direction="column"
        sx={{ justifyContent: "space-between" }}>
        <Grid
          item
          container>
          <ToggleButtonGroup
            sx={{
              marginLeft: "0.5vw",
              width: `calc(${chartsDrawerWidth} - 1vw)`,
            }}
            value={visualizationMode}
            exclusive
            onChange={handleVisualizationModeChange}
            size="small"
            fullWidth={true}
            aria-label="visualization mode">
            {disableInteractiveMode ? (
              <Tooltip
                title="This indicator does not support interactive mode"
                placement="top"
                arrow>
                <span>
                  <ToggleButton
                    value="deck"
                    disabled={disableInteractiveMode}
                    aria-label="interactive map">
                    <MapIcon fontSize="small" />
                    <Typography
                      variant="caption"
                      sx={{ ml: 1 }}>
                      Interactive
                    </Typography>
                  </ToggleButton>
                </span>
              </Tooltip>
            ) : (
              <ToggleButton
                value="deck"
                disabled={disableInteractiveMode}
                aria-label="interactive map">
                <MapIcon fontSize="small" />
                <Typography
                  variant="caption"
                  sx={{ ml: 1 }}>
                  Interactive
                </Typography>
              </ToggleButton>
            )}
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
          container
          direction="column"
          sx={{
            alignItems: "center",
          }}>
          <ChartCard
            title={tabLabels[0]}
            data={data?.horizontalStackedBars}
            MemoizedChart={MemoizedHorizontalStackedBar}
          />
          <ChartCard
            title={tabLabels[1]}
            data={data?.stackedBars}
            MemoizedChart={MemoizedBarChart}
          />
          <ChartCard
            title={tabLabels[2]}
            data={data?.radar}
            MemoizedChart={MemoizedRadarChart}
          />
          <ChartCard
            title={tabLabels[3]}
            data={data?.pieChart}
            MemoizedChart={MemoizedPieChart}
          />
        </Grid>
      </Grid>
    </Drawer>
  );
};

export default ChartsDrawer;

// Memoize components to avoid unnecessary re-renders
const MemoizedRadarChart = React.memo(RadarChart, (prevProps, nextProps) =>
  isEqual(prevProps.data, nextProps.data),
);
const MemoizedPieChart = React.memo(PieChart);
const MemoizedBarChart = React.memo(StackedBarChart, (prevProps, nextProps) =>
  isEqual(prevProps.data, nextProps.data),
);
const MemoizedHorizontalStackedBar = React.memo(
  HorizontalStackedBar,
  (prevProps, nextProps) => isEqual(prevProps.data, nextProps.data),
);
