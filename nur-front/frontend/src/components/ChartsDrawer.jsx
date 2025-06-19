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
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

import isEqual from "lodash/isEqual";

import { useAppData } from "../DataContext";
import { chartsDrawerWidth } from "../style/drawersStyles";

import RadarChart from "./charts/RadarChart";
import PieChart from "./charts/PieChart";
import HorizontalStackedBar from "./charts/HorizontalStackedBar";
import StackedBarChart from "./charts/BarChart";
import ChartCard from "./ChartCard";

const ChartsDrawer = ({ handleChartsClick, openCharts }) => {
  const {
    visualizationMode,
    handleVisualizationModeChange,
    dashboardData: data,
    getTabLabels,
  } = useAppData();

  const tabLabels = getTabLabels();

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
        direction="column"
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
          container
          direction="column">
          <Grid item>
            <ChartCard
              title={tabLabels[0]}
              data={data?.horizontalStackedBars}
              MemoizedChart={MemoizedHorizontalStackedBar}
            />

            {/* <Card>
              <CardHeader
                title="bar chart"
                action={
                  <ExpandMore
                    expand={expanded}
                    onClick={handleExpandClick}
                    //aria-expanded={expanded}
                    //aria-label="show more"
                  >
                    <ExpandMoreIcon />
                  </ExpandMore>
                }></CardHeader>
              <Collapse
                in={expanded}
                timeout="auto"
                unmountOnExit>
                <CardContent>
                  <MemoizedBarChart data={data?.stackedBars} />
                </CardContent>
              </Collapse>
            </Card> */}
          </Grid>
          <Grid item>
            <ChartCard
              title={tabLabels[1]}
              data={data?.stackedBars}
              MemoizedChart={MemoizedBarChart}
            />
          </Grid>
          <Grid item>
            <ChartCard
              title={tabLabels[2]}
              data={data?.radar}
              MemoizedChart={MemoizedRadarChart}
            />
          </Grid>
          <Grid item>
            <ChartCard
              title={tabLabels[3]}
              data={data?.pieChart}
              MemoizedChart={MemoizedPieChart}
            />
          </Grid>
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
