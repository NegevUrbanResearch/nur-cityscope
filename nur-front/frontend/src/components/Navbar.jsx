import React from "react";
import { AppBar, Toolbar, Box, IconButton, Grid } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import ChartsDrawer from "./drawer/ChartsDrawer";

const Navbar = () => {
  const [openCharts, setOpenCharts] = React.useState(true);

  const handleChartsClick = () => {
    setOpenCharts(!openCharts);
  };

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
            sx={{
              justifyContent: "space-between",
              alignItems: "center",
            }}>
            <Grid item>
              <IconButton
                edge="end"
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
