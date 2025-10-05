import React from "react";

import {
  Button,
  MenuItem,
  Menu,
  Typography,
  useTheme,
  useMediaQuery,
  Box,
} from "@mui/material";
import buttonStyles  from "../style/buttonStyles";
import { useNavigate } from "react-router-dom";
import { useAppData } from "../DataContext";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";

const NavMenu = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isTablet = useMediaQuery(theme.breakpoints.between("sm", "md"));

  const {
    currentIndicator,
    changeIndicator,
    changeState,
    indicatorConfig,
    StateConfig,
  } = useAppData();
  const [indicatorAnchorEl, setIndicatorAnchorEl] = React.useState(null);
  const [stateAnchorEl, setStateAnchorEl] = React.useState(null);

  const openIndicator = Boolean(indicatorAnchorEl);
  const openState = Boolean(stateAnchorEl);

  const handleClickIndicator = (event) => {
    setIndicatorAnchorEl(event.currentTarget);
  };
  const handleCloseIndicator = () => {
    setIndicatorAnchorEl(null);
  };
  const handleClickState = (event) => {
    setStateAnchorEl(event.currentTarget);
  };
  const handleCloseState = () => {
    setStateAnchorEl(null);
  };

  const handleIndicatorChange = (indicator) => {
    changeIndicator(indicator);
    navigate(`/${indicator}`);
    handleCloseIndicator();
  };

  const currButtonStyles = {
    minWidth: { xs: "90px", sm: "100px" },
    height: { xs: "32px", sm: "36px" },
   ...buttonStyles
  };  

  return (
    <Box sx={{ width: "100%" }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: { xs: 2, sm: 2.5 },
          width: "100%",
        }}
      >
        <Button
          sx={currButtonStyles}
          onClick={handleClickIndicator}
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
            }}
          >
            Indicator
          </Typography>
        </Button>

        <Button
          sx={currButtonStyles}
          onClick={handleClickState}
          color="inherit"
          disabled={StateConfig[currentIndicator]?.length === 0}
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
            }}
          >
            State
          </Typography>
        </Button>
      </Box>

      {/* Indicator Menu */}
      <Menu
        anchorEl={indicatorAnchorEl}
        open={openIndicator}
        onClose={handleCloseIndicator}
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
        {Object.entries(indicatorConfig).map(([key, config]) => (
          <MenuItem
            onClick={() => handleIndicatorChange(key)}
            sx={{
              py: 1,
              px: 2,
              backgroundColor:
                key === currentIndicator
                  ? "rgba(100, 181, 246, 0.12)"
                  : "transparent",
              borderLeft:
                key === currentIndicator
                  ? "3px solid #64B5F6"
                  : "3px solid transparent",
              transition: "all 0.15s ease",
              "&:hover": {
                backgroundColor: "rgba(100, 181, 246, 0.18)",
                borderLeft: "3px solid #64B5F6",
              },
            }}
            key={key}
          >
            <Typography
              variant="body1"
              sx={{
                fontWeight: key === currentIndicator ? 600 : 500,
                fontSize: { xs: "0.9rem", sm: "0.95rem" },
                color:
                  key === currentIndicator
                    ? "#64B5F6"
                    : "rgba(255, 255, 255, 0.85)",
                letterSpacing: "0.2px",
              }}
            >
              {config.name.replace("Dashboard", "").trim()}
            </Typography>
          </MenuItem>
        ))}
      </Menu>

      {/* State Menu */}
      <Menu
        anchorEl={stateAnchorEl}
        open={openState}
        onClose={handleCloseState}
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
        {StateConfig[currentIndicator]?.map((element) => (
          <MenuItem
            onClick={() => {
              changeState(element);
              handleCloseState();
            }}
            sx={{
              py: 1,
              px: 2,
              borderLeft: "3px solid transparent",
              transition: "all 0.15s ease",
              "&:hover": {
                backgroundColor: "rgba(100, 181, 246, 0.18)",
                borderLeft: "3px solid #64B5F6",
              },
            }}
            key={element}
          >
            <Typography
              variant="body1"
              sx={{
                fontSize: { xs: "0.9rem", sm: "0.95rem" },
                fontWeight: 500,
                color: "rgba(255, 255, 255, 0.85)",
                letterSpacing: "0.2px",
              }}
            >
              {element}
            </Typography>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
};

export default NavMenu;
