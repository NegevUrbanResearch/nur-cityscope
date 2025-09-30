import React from "react";
import {
  IconButton,
  Drawer,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Tooltip,
  Box,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlineIcon from "@mui/icons-material/InfoOutline";

import { useAppData } from "../../DataContext";
import { chartsDrawerWidth } from "../../style/drawersStyles";

import NavMenu from "../NavMenu";
import InfoDialog from "../InfoDialog";
import IndicatorGraphs from "./IndicatorGraphs";
import ClimateGraphs from "./ClimateGraphs";
import config from "../../config";
import ClimateMapTypeSelector from "./ClimateMapTypeSelector";

const ChartsDrawer = ({ handleChartsClick, openCharts }) => {
  const { visualizationMode, handleVisualizationModeChange, currentIndicator } =
    useAppData();

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const isTablet = useMediaQuery(theme.breakpoints.between("md", "lg"));

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
          backgroundImage:
            "linear-gradient(to bottom, rgba(30, 30, 30, 0.98), rgba(18, 18, 18, 0.95))",
          borderLeft: "1px solid rgba(255, 255, 255, 0.1)",
        },
      }}
      variant="persistent"
      anchor="right"
      open={openCharts}
    >
      {/* Header Section */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          p: { xs: 1, sm: 1.5 },
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          backgroundColor: "rgba(0, 0, 0, 0.2)",
        }}
      >
        {/* Left: Close/Info Buttons */}
        <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>
          <IconButton
            onClick={handleChartsClick}
            sx={{
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              "&:hover": {
                backgroundColor: "rgba(255, 255, 255, 0.1)",
                transform: "scale(1.05)",
              },
              transition: "all 0.2s ease-in-out",
            }}
            size="small"
          >
            <CloseIcon fontSize="small" />
          </IconButton>

          <IconButton
            onClick={handleClickInfo}
            sx={{
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              "&:hover": {
                backgroundColor: "rgba(255, 255, 255, 0.1)",
                transform: "scale(1.05)",
              },
              transition: "all 0.2s ease-in-out",
            }}
            size="small"
          >
            <InfoOutlineIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Center: Navigation Menu */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <NavMenu />
        </Box>

        {/* Right: Logo */}
        <Box sx={{ flexShrink: 0 }}>
          <img
            src={config.frontend.logo.url}
            alt="nur"
            style={{
              width: isMobile ? "50px" : isTablet ? "60px" : "70px",
              verticalAlign: "middle",
              filter: "brightness(0) invert(1)",
              transition: "width 0.3s ease",
            }}
          />
        </Box>

        <InfoDialog openInfo={openInfo} handleCloseInfo={handleClickInfo} />
      </Box>

      {/* Climate Map Type Selector or Visualization Mode Toggle */}
      {currentIndicator === "climate" ? (
        <ClimateMapTypeSelector />
      ) : (
        <Box
          sx={{
            px: { xs: 1.5, sm: 2 },
            pt: { xs: 1.5, sm: 2 },
            pb: { xs: 1, sm: 1.5 },
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <ToggleButtonGroup
            sx={{
              display: "flex",
              gap: 1,
              width: "100%",
              "& .MuiToggleButton-root": {
                flex: 1,
                height: { xs: "36px", sm: "40px" },
                py: 0,
                px: { xs: 1.5, sm: 2 },
                border: "1px solid rgba(255, 255, 255, 0.2)",
                borderRadius: "6px",
                color: "rgba(255, 255, 255, 0.7)",
                textTransform: "none",
                fontSize: { xs: "0.95rem", sm: "1rem" },
                fontWeight: 600,
                letterSpacing: "0.3px",
                transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                "&:hover": {
                  backgroundColor: "rgba(100, 181, 246, 0.12)",
                  borderColor: "rgba(100, 181, 246, 0.5)",
                  transform: "translateY(-1px)",
                  boxShadow: "0 4px 12px rgba(100, 181, 246, 0.15)",
                },
                "&.Mui-selected": {
                  backgroundColor: "rgba(100, 181, 246, 0.18)",
                  color: "#64B5F6",
                  borderColor: "#64B5F6",
                  fontWeight: 700,
                  boxShadow: "0 2px 8px rgba(100, 181, 246, 0.2)",
                  "&:hover": {
                    backgroundColor: "rgba(100, 181, 246, 0.25)",
                    transform: "translateY(-1px)",
                    boxShadow: "0 4px 12px rgba(100, 181, 246, 0.25)",
                  },
                },
                "&.Mui-disabled": {
                  color: "rgba(255, 255, 255, 0.3)",
                  borderColor: "rgba(255, 255, 255, 0.1)",
                  backgroundColor: "rgba(255, 255, 255, 0.02)",
                },
              },
            }}
            value={visualizationMode}
            exclusive
            onChange={handleVisualizationModeChange}
            size="small"
            aria-label="visualization mode"
          >
            {disableInteractiveMode ? (
              <Tooltip
                title="This indicator does not support interactive mode"
                placement="top"
                arrow
              >
                <span style={{ flex: 1 }}>
                  <ToggleButton
                    value="deck"
                    disabled={disableInteractiveMode}
                    aria-label="interactive map"
                    sx={{ width: "100%" }}
                  >
                    Interactive
                  </ToggleButton>
                </span>
              </Tooltip>
            ) : (
              <ToggleButton
                value="deck"
                disabled={disableInteractiveMode}
                aria-label="interactive map"
              >
                Interactive
              </ToggleButton>
            )}
            <ToggleButton value="image" aria-label="static image">
              Image
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      )}

      {/* Charts Content */}
      <Box
        sx={{
          px: { xs: 1, sm: 1.5, md: 2 },
          pb: 2,
          overflowX: "hidden",
          overflowY: "visible",
        }}
      >
        {currentIndicator === "climate" ? (
          <ClimateGraphs />
        ) : (
          <IndicatorGraphs />
        )}
      </Box>
    </Drawer>
  );
};

export default ChartsDrawer;
