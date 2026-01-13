import React from "react";
import { useNavigate } from "react-router-dom";
import {
  IconButton,
  Drawer,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Box,
  useTheme,
  Menu,
  MenuItem,
  useMediaQuery,
  Button,
  Typography,
  ButtonBase,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlineIcon from "@mui/icons-material/InfoOutline";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import buttonStyles from "../../style/buttonStyles";


import { useAppData } from "../../DataContext";
import { chartsDrawerWidth } from "../../style/drawersStyles";

import NavMenu from "../NavMenu";
import InfoDialog from "../InfoDialog";
import IndicatorGraphs from "./IndicatorGraphs";
import ClimateGraphs from "./ClimateGraphs";
import config from "../../config";
import ClimateMapTypeSelector from "./ClimateMapTypeSelector";


const ChartsDrawer = ({ handleChartsClick, openCharts }) => {
  const navigate = useNavigate();
  const { 
    visualizationMode, 
    handleVisualizationModeChange, 
    currentIndicator,
    isPresentationMode,
    exitPresentationAndResume,
    currentTable,
    availableTables,
    changeTable,
  } = useAppData();

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const isTablet = useMediaQuery(theme.breakpoints.between("md", "lg"));

  const [openInfo, setOpenInfo] = React.useState(false);

  const handleClickInfo = () => {
    setOpenInfo(!openInfo);
  };

  const handleOpenPresentation = () => {
    navigate('/presentation');
  };

  const handleOpenUserUploads = () => {
    navigate('/user-uploads');
  };

  let disableInteractiveMode = false;

  React.useEffect(() => {
    if (currentIndicator === "climate" && visualizationMode !== 'image') {
      handleVisualizationModeChange(null, "image");
    }
  }, [currentIndicator, visualizationMode, handleVisualizationModeChange]);

  if (currentIndicator === "climate") {
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
          overflowY: "hidden",
          backgroundImage:
            "linear-gradient(to bottom, rgba(30, 30, 30, 0.98), rgba(18, 18, 18, 0.95))",
          borderLeft: "1px solid rgba(255, 255, 255, 0.1)",
          display: "flex",
          flexDirection: "column",
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
          flexShrink: 0,
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

          <TableMenu />

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
            flexShrink: 0,
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
          overflowY: "auto",
          flexGrow: 1,
          minHeight: 0,
          position: 'relative',
        }}
      >
        {/* Pause Overlay - Clickable button to resume dashboard */}
        {isPresentationMode && (
          <ButtonBase
            onClick={exitPresentationAndResume}
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              bgcolor: 'rgba(0, 0, 0, 0.85)',
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              px: 3,
              cursor: 'pointer',
              transition: 'background-color 0.2s ease',
              '&:hover': {
                bgcolor: 'rgba(0, 0, 0, 0.9)',
              },
            }}
          >
            <PauseIcon sx={{ color: '#ff9800', fontSize: 48 }} />
            <Typography 
              variant="h6" 
              sx={{ 
                color: 'white', 
                fontWeight: 600, 
                textAlign: 'center' 
              }}
            >
              Presentation Mode Active
            </Typography>
            
            <Box 
              sx={{ 
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                bgcolor: 'rgba(76, 175, 80, 0.2)',
                px: 3,
                py: 1.5,
                borderRadius: 2,
                border: '2px solid #4CAF50',
                mt: 2,
                transition: 'all 0.2s ease',
                '&:hover': {
                  bgcolor: 'rgba(76, 175, 80, 0.3)',
                  transform: 'scale(1.02)',
                },
              }}
            >
              <PlayArrowIcon sx={{ color: '#4CAF50', fontSize: 24 }} />
              <Typography 
                variant="body1" 
                sx={{ 
                  color: '#4CAF50', 
                  fontWeight: 700,
                }}
              >
                Click to Resume Dashboard
              </Typography>
            </Box>
            
            <Typography 
              variant="caption" 
              sx={{ 
                color: 'rgba(255,255,255,0.5)', 
                textAlign: 'center',
                mt: 1,
              }}
            >
              Returns to Mobility Dashboard
            </Typography>
          </ButtonBase>
        )}
        
        <Box
          sx={{
            opacity: isPresentationMode ? 0.3 : 1,
            pointerEvents: isPresentationMode ? 'none' : 'auto',
            transition: 'opacity 0.3s ease',
          }}
        >
          {currentIndicator === "climate" ? (
            <ClimateGraphs />
          ) : (
            <IndicatorGraphs />
          )}
        </Box>
      </Box>


      {/* Presentation Mode and UGC Management Links */}
      <Box
        sx={{
          p: 2,
          display: 'flex',
          flexDirection: 'row',
          gap: 1.5,
          justifyContent: 'center',
          flexShrink: 0,
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          backgroundColor: 'rgba(18, 18, 18, 0.95)',
        }}
      >
        <Button
          variant="outlined"
          onClick={handleOpenPresentation}
          startIcon={<SlideshowIcon />}
          sx={{
            flex: 1,
            maxWidth: '200px',
            fontWeight: 600,
            fontSize: '0.9rem',
            color: 'rgba(255,255,255,0.8)',
            borderColor: 'rgba(255,255,255,0.2)',
            padding: '10px 20px',
            borderRadius: '6px',
            '&:hover': {
              borderColor: '#64B5F6',
              color: '#64B5F6',
              backgroundColor: 'rgba(100, 181, 246, 0.08)',
            },
            transition: 'all 0.2s ease',
          }}
        >
          Presentation Mode
        </Button>
        <Button
          variant="outlined"
          onClick={handleOpenUserUploads}
          startIcon={<CloudUploadIcon />}
          sx={{
            flex: 1,
            maxWidth: '200px',
            fontWeight: 600,
            fontSize: '0.9rem',
            color: 'rgba(255,255,255,0.8)',
            borderColor: 'rgba(255,255,255,0.2)',
            padding: '10px 20px',
            borderRadius: '6px',
            '&:hover': {
              borderColor: '#4CAF50',
              color: '#4CAF50',
              backgroundColor: 'rgba(76, 175, 80, 0.08)',
            },
            transition: 'all 0.2s ease',
          }}
        >
          Manage UGC
        </Button>
      </Box>
    </Drawer>
  );
};

export default ChartsDrawer;




const TableMenu = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isTablet = useMediaQuery(theme.breakpoints.between("sm", "md"));

  const [anchorEl, setAnchorEl] = React.useState(null);
  const open = Boolean(anchorEl);

  const { currentTable, availableTables, changeTable } = useAppData();

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleTableSelect = (tableName) => {
    handleClose();
    if (tableName !== currentTable) {
      changeTable(tableName);
    }
  };

  const currButtonStyles = {
    minWidth: { xs: "90px", sm: "100px" },
    height: { xs: "32px", sm: "36px" },
    ...buttonStyles 
  };

  const currentTableDisplayName = availableTables.find(t => t.name === currentTable)?.display_name || currentTable;

  return (
    <Box>
      <Button
        sx={currButtonStyles}
        onClick={handleClick}
        color="inherit"
        endIcon={<ArrowDropDownIcon fontSize="small" />}
      >
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            fontSize: { xs: "0.95rem", sm: "1rem" },
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis", 
            letterSpacing: "0.3px",
            textTransform: "none",
          }}
        >
          {currentTableDisplayName}
        </Typography>
      </Button>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        PaperProps={{
          sx: {
            mt: 0.5,
            minWidth: isMobile ? "80vw" : isTablet ? "180px" : "200px",
            backgroundColor: "rgba(25, 25, 25, 0.98)",
            backdropFilter: "blur(16px)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "8px",
            boxShadow:
              "0 8px 24px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3)",
          },
        }}
      >
        {availableTables && availableTables.length > 0 ? (
          availableTables.map((table) => {
            const isCurrentTable = table.name === currentTable;

            return (
              <MenuItem
                key={table.id || table.name}
                onClick={() => handleTableSelect(table.name)}
                sx={{
                  py: 1,
                  px: 2,
                  backgroundColor: isCurrentTable ? "rgba(100, 181, 246, 0.12)" : "transparent",
                  borderLeft: isCurrentTable ? "3px solid #64B5F6" : "3px solid transparent",
                  transition: "all 0.15s ease",
                  "&:hover": {
                    backgroundColor: "rgba(100, 181, 246, 0.18)",
                    borderLeft: "3px solid #64B5F6",
                  },
                }}
              >
                <Typography
                  variant="body1"
                  sx={{
                    fontSize: { xs: "0.9rem", sm: "0.95rem" },
                    fontWeight: isCurrentTable ? 600 : 500,
                    color: isCurrentTable ? "#64B5F6" : "rgba(255, 255, 255, 0.85)",
                    letterSpacing: "0.2px",
                  }}
                >
                  {table.display_name || table.name}
                </Typography>
              </MenuItem>
            );
          })
        ) : (
          <MenuItem disabled>
            <Typography variant="body2" sx={{ color: "rgba(255, 255, 255, 0.5)" }}>
              No tables available
            </Typography>
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
};