import React from "react";
import { AppBar, Toolbar, Typography, Button, Box } from "@mui/material";
import { Link } from "react-router-dom";
import config from "../config";

const Navbar = () => {
  return (
    <AppBar position="fixed">
      <Toolbar>
        <Box sx={{ flexGrow: 1 }}>
          <Button
            color="inherit"
            component={Link}
            to="/dashboard"
            sx={{ py: 2, px: 4, textTransform: "none" }}
          >
            <Typography variant="h6">Dashboard</Typography>
          </Button>
          <Button
            color="inherit"
            component={Link}
            to="/climate"
            sx={{ py: 2, px: 4, textTransform: "none" }}
          >
            <Typography variant="h6">Climate</Typography>
          </Button>
          <Button
            color="inherit"
            component={Link}
            to="/land_use"
            sx={{ py: 2, px: 4, textTransform: "none" }}
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
