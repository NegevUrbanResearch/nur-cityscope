import React from "react";

import { Grid, Button, MenuItem, Menu, Typography } from "@mui/material";

import { useNavigate } from "react-router-dom";
import { useAppData } from "../DataContext";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";

const NavMenu = () => {
  const navigate = useNavigate();
  const { currentIndicator, changeIndicator, indicatorConfig, StateConfig } = useAppData();
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
  // Handle direct indicator change from navbar
  const handleIndicatorChange = (indicator) => {
    // Change the indicator (which will also update the remote controller)
    changeIndicator(indicator);

    // Update the URL to match - note the correct URL without "dashboard" prefix
    navigate(`/${indicator}`);
  };

  // need to add state change handler and current state to context (and different image for each state)

  return (
    <Grid item container justifyContent="space-between" alignItems="center" spacing={3}>

      <Button
        sx={{
          height: "7vh",
          textTransform: "none",
          width: "9vw",
          border: "0.1px solid white",minHeight: 0, minWidth: 0, padding: 0 
        }}
        onClick={handleClickIndicator}
        color="inherit"
        size="large"
        endIcon={<ArrowDropDownIcon />}>
        <Typography variant="h6">Indicator</Typography>
      </Button>

      <Button
        sx={{
          height: "7vh",
          textTransform: "none",
          width: "9vw",
          border: "0.1px solid white",minHeight: 0, minWidth: 0, padding: 0 
        }}
        onClick={handleClickState}
        color="inherit"
        size="large"
        disabled={StateConfig[currentIndicator]?.length === 0}
        endIcon={<ArrowDropDownIcon />}>
        <Typography variant="h6">State</Typography>
      </Button>

      <Menu
        anchorEl={indicatorAnchorEl}
        open={openIndicator}
        onClose={handleCloseIndicator}>
        {Object.entries(indicatorConfig).map(([key, config]) => (
          <MenuItem
            onClick={() => handleIndicatorChange(key)}
            sx={{
              width: "12.5vw",
              backgroundColor:
                key === currentIndicator ? "#ffffff1a" : "#1e1e1e",
            }}
            key={key}>
            <Typography variant="h6">
              {config.name.replace("Dashboard", "").trim()}
            </Typography>
          </MenuItem>
        ))}
      </Menu>

      <Menu
        anchorEl={stateAnchorEl}
        open={openState}
        onClose={handleCloseState}>
        {StateConfig[currentIndicator].map(element => (
          <MenuItem
            //onClick={() => handleIndicatorChange(key)}
            sx={{
              width: "12.5vw",
              height: "7vh",
              //backgroundColor:
              // key === currentIndicator ? "#ffffff1a" : "#1e1e1e",
            }}
            key={element}>
            <Typography variant="h6">
              {element}
            </Typography>
          </MenuItem>
        ))}

      </Menu>

    </Grid>
  );
};

export default NavMenu;
