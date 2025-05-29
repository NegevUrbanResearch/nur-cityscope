import React from "react";
import { AppBar, Toolbar, Typography, Button, Box, Tooltip } from "@mui/material";
import { useNavigate } from "react-router-dom";
import config from "../config";
import { useAppData } from "../DataContext";

const Navbar = () => {
  const navigate = useNavigate();
  const { currentIndicator, changeIndicator, indicatorConfig } = useAppData();

  // Handle direct indicator change from navbar
  const handleIndicatorChange = (indicator) => {
    // Change the indicator (which will also update the remote controller)
    changeIndicator(indicator);
    
    // Update the URL to match - note the correct URL without "dashboard" prefix
    navigate(`/${indicator}`);
  };

  return (
    <AppBar position="fixed">
      <Toolbar>
        <Box sx={{ flexGrow: 1 }}>
          {Object.entries(indicatorConfig).map(([key, config]) => (
            <Tooltip 
              key={key}
              title="Click to change indicator (also updates remote controller)"
              arrow
              placement="bottom"
            >
              <Button
                color="inherit"
                onClick={() => handleIndicatorChange(key)}
                sx={{ 
                  py: 2, 
                  px: 4, 
                  textTransform: "none",
                  backgroundColor: currentIndicator === key ? "rgba(255, 255, 255, 0.1)" : "transparent",
                  transition: "background-color 0.3s ease",
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.15)"
                  }
                }}
              >
                <Typography variant="h6">{config.name.replace('Dashboard', '').trim()}</Typography>
              </Button>
            </Tooltip>
          ))}
        </Box>

        <Typography variant="h5">
          <img src={config.frontend.logo.url} alt="nur" style={{ width: '160px', verticalAlign: 'middle', filter: 'brightness(0) invert(1)' }} />
        </Typography>
      </Toolbar>
    </AppBar>
  );
};

export default Navbar;
