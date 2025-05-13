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
            to="/"
            sx={{ py: 2, px: 4, textTransform: "none" }}
          >
            {" "}
            {/* should map 1 be the default page? */}
            <Typography variant="h6">mobility</Typography>
          </Button>
          <Button
            color="inherit"
            component={Link}
            to="/climate"
            sx={{ py: 2, px: 4, textTransform: "none" }}
          >
            <Typography variant="h6">climate </Typography>
          </Button>
          <Button
            color="inherit"
            component={Link}
            to="/land_use"
            sx={{ py: 2, px: 4, textTransform: "none" }}
          >
            <Typography variant="h6"> land use </Typography>
          </Button>
        </Box>

        <Typography variant="h5">
          logo here
          {/* <Box
            component="img"
            src={config.frontend.logo.url}
            alt="CityLab Biobío"
            sx={{
              height: '80px',
              //width: 350,
            }}
          /> */}
          {/* <img
          src={config.frontend.logo.url}
          alt="CityLab Biobío"
          style={{ width: config.frontend.logo.width }}
        /> */}
        </Typography>
      </Toolbar>
    </AppBar>
  );
};

export default Navbar;
