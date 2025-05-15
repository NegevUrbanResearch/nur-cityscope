import React from "react";
import { AppBar, Toolbar, Typography, Button, Box } from "@mui/material";
import { Link, useLocation } from "react-router-dom";
import config from "../config";
import { useAppData } from "../DataContext";

const Navbar = () => {
  const location = useLocation();
  const { currentIndicator } = useAppData();

  return (
    <AppBar position="fixed">
      <Toolbar>
        <Box sx={{ flexGrow: 1 }}>
          <Button
            color="inherit"
            component={Link}
            to="/dashboard/mobility"
            sx={{ 
              py: 2, 
              px: 4, 
              textTransform: "none",
              backgroundColor: currentIndicator === "mobility" ? "rgba(255, 255, 255, 0.1)" : "transparent"
            }}
          >
            <Typography variant="h6">Mobility</Typography>
          </Button>
          <Button
            color="inherit"
            component={Link}
            to="/dashboard/climate"
            sx={{ 
              py: 2, 
              px: 4, 
              textTransform: "none",
              backgroundColor: currentIndicator === "climate" ? "rgba(255, 255, 255, 0.1)" : "transparent"
            }}
          >
            <Typography variant="h6">Climate</Typography>
          </Button>
          <Button
            color="inherit"
            component={Link}
            to="/dashboard/land_use"
            sx={{ 
              py: 2, 
              px: 4, 
              textTransform: "none",
              backgroundColor: currentIndicator === "land_use" ? "rgba(255, 255, 255, 0.1)" : "transparent"
            }}
          >
            <Typography variant="h6">Land Use</Typography>
          </Button>
        </Box>

        <Typography variant="h5">
          <img src={config.frontend.logo.url} alt="nur" style={{ width: '160px', verticalAlign: 'middle', filter: 'brightness(0) invert(1)' }} />
        </Typography>
      </Toolbar>
    </AppBar>
  );
};

export default Navbar;
