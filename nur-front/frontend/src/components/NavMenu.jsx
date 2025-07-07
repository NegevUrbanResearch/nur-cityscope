import React from "react";

import { Grid, Typography, Button, MenuItem, Menu } from "@mui/material";

import { useNavigate } from "react-router-dom";
import { useAppData } from "../DataContext";
import { chartsDrawerWidth } from "../style/drawersStyles";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";

const NavMenu = () => {
  const navigate = useNavigate();
  const { currentIndicator, changeIndicator, indicatorConfig } = useAppData();
  const [anchorEl, setAnchorEl] = React.useState(null);
  const open = Boolean(anchorEl);
  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };
  const handleClose = () => {
    setAnchorEl(null);
  };
  // Handle direct indicator change from navbar
  const handleIndicatorChange = (indicator) => {
    // Change the indicator (which will also update the remote controller)
    changeIndicator(indicator);

    // Update the URL to match - note the correct URL without "dashboard" prefix
    navigate(`/${indicator}`);
  };

  return (
    <Grid
      container
      item
      width={`calc(100% - ${chartsDrawerWidth})`}
      justifyContent="space-around"
      direction="row">
      <Typography variant="h6"> Indicator </Typography>
      <Button
        sx={{ height: "7vh" }}
        onClick={handleClick}
        color="inherit"
        size="large"
        startIcon={<ArrowDropDownIcon />}>
        {currentIndicator}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}>
        {Object.entries(indicatorConfig).map(([key, config]) => (
          <MenuItem onClick={() => handleIndicatorChange(key)}>
            {config.name.replace("Dashboard", "").trim()}{" "}
          </MenuItem>
        ))}
      </Menu>
    </Grid>
  );
};

export default NavMenu;
