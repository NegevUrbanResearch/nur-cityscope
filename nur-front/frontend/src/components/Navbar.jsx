import React from "react";
import { AppBar, Toolbar, Box, IconButton, Grid } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import ChartsDrawer from "./drawer/ChartsDrawer";

const Navbar = ({ handleChartsClick, openCharts }) => {


  return (
    <Box>
      <AppBar
        elevation={0}
        color="transparent"
        position="fixed"
        openCharts={openCharts}>
        <Toolbar>
          <Grid
            width="100vw"
            container
            direction="row"
            justifyContent="end"
            alignItems="center"
          >
            <Grid item>
              <IconButton
                edge="flex-start"
                onClick={handleChartsClick}>
                <MenuIcon />
              </IconButton>
            </Grid>
          </Grid>
        </Toolbar>
      </AppBar>

      <ChartsDrawer
        openCharts={openCharts}
        handleChartsClick={handleChartsClick}
      />
    </Box>
  );
};

export default Navbar;
