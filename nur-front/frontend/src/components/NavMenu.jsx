import React from "react";

import { Grid, Button, MenuItem, Menu, Typography } from "@mui/material";

import { useNavigate } from "react-router-dom";
import { useAppData } from "../DataContext";
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
    <Grid item>
      <Button
        sx={{ height: "7vh", textTransform: "none" }}
        onClick={handleClick}
        color="inherit"
        size="large"
        startIcon={<ArrowDropDownIcon />}>
        <Typography variant="h6">{currentIndicator}</Typography>
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}>
        {Object.entries(indicatorConfig).map(([key, config]) => (
          <MenuItem onClick={() => handleIndicatorChange(key)}>
            <Typography variant="h6">
              {config.name.replace("Dashboard", "").trim()}
            </Typography>
          </MenuItem>
        ))}
      </Menu>
    </Grid>
  );
};

export default NavMenu;
