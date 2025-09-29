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
import InfoOutlineIcon from "@mui/icons-material/InfoOutline";

import { useAppData } from "../../DataContext";
import { chartsDrawerWidth } from "../../style/drawersStyles";

import NavMenu from "../NavMenu";
import InfoDialog from "../InfoDialog";
import IndicatorGraphs from "./IndicatorGraphs";
import ClimateGraphs from "./ClimateGraphs";
import config from "../../config";


const ChartsDrawer = ({ handleChartsClick, openCharts }) => {
  const { visualizationMode, handleVisualizationModeChange, currentIndicator } =
    useAppData();

  const [openInfo, setOpenInfo] = React.useState(false);

  const handleClickInfo = () => {
    setOpenInfo(!openInfo);
  };

  let disableInteractiveMode = false;

  if (currentIndicator === "climate") {
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
          overflowX: "hidden",
          overflowY: "auto",
        },
      }}
      variant="persistent"
      anchor="right"
      open={openCharts}
    >
      <Grid
        container
        sx={{
          justifyContent: "space-between",
          alignItems: "center",
          height: "76px",
          width: "100%",
        }}
      >
        <Grid item container >
          <IconButton
            onClick={handleChartsClick}
            sx={{ backgroundColor: "transparent" }}
          >
            <CloseIcon />
          </IconButton>

          <IconButton
            sx={{ backgroundColor: "transparent" }}
            onClick={handleClickInfo}
          >
            <InfoOutlineIcon />
          </IconButton>
        </Grid>


        <NavMenu />

        <img
          src={config.frontend.logo.url}
          alt="nur"
          style={{
            width: "80px",
            verticalAlign: "middle",
            filter: "brightness(0) invert(1)",
          }}
        />

        <InfoDialog openInfo={openInfo} handleCloseInfo={handleClickInfo} />

      </Grid>

      <Grid
        container
        direction="column"
        sx={{ justifyContent: "space-between" }}
      >
        <Grid item container>
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
            aria-label="visualization mode"
          >
            {disableInteractiveMode ? (
              <Tooltip
                title="This indicator does not support interactive mode"
                placement="top"
                arrow
              >
                <span>
                  <ToggleButton
                    value="deck"
                    disabled={disableInteractiveMode}
                    aria-label="interactive map"
                  >
                    <MapIcon fontSize="small" />
                    <Typography variant="caption" sx={{ ml: 1 }}>
                      Interactive
                    </Typography>
                  </ToggleButton>
                </span>
              </Tooltip>
            ) : (
              <ToggleButton
                value="deck"
                disabled={disableInteractiveMode}
                aria-label="interactive map"
              >
                <MapIcon fontSize="small" />
                <Typography variant="caption" sx={{ ml: 1 }}>
                  Interactive
                </Typography>
              </ToggleButton>
            )}
            <ToggleButton value="image" aria-label="static image">
              <ImageIcon fontSize="small" />
              <Typography variant="caption" sx={{ ml: 1 }}>
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
            alignItems: "stretch",
            overflowX: "hidden",
            overflowY: "visible",
            maxWidth: "100%",
            padding: "0 8px",
          }}
        >
          {currentIndicator === "climate" ? (
            <ClimateGraphs />
          ) : (
            <IndicatorGraphs />
          )}
        </Grid>
      </Grid>
    </Drawer>
  );
};

export default ChartsDrawer;
