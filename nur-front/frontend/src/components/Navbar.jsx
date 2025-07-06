import React from "react";
import { AppBar, Toolbar, Box, IconButton, Grid } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import config from "../config";
import NavMenu from "./NavMenu";
import ChartsDrawer from "./ChartsDrawer";
import { chartsDrawerWidth } from "../style/drawersStyles";

const Navbar = () => {
  const [openCharts, setOpenCharts] = React.useState(true);

  const handleChartsClick = () => {
    setOpenCharts(!openCharts);
  };

  return (
    <Box>
      <AppBar
        position="fixed"
        openCharts={openCharts}>
        <Toolbar>
          <Grid
            container
            width="100%"
            justifyContent="space-between">
            <Grid
              container
              item
              width={`calc(100% - ${chartsDrawerWidth})`}
              justifyContent="space-between"
              alignItems="center">
              <Grid
                item
                xs={4}>
                {/* need to change navbar height according to the img */}
                <img
                  src={config.frontend.logo.url}
                  alt="nur"
                  style={{
                    width: "160px",
                    verticalAlign: "middle",
                    filter: "brightness(0) invert(1)",
                  }}
                />
              </Grid>
              <Grid
                item
                xs={4}>
                <NavMenu />
                {/* scroll */}
              </Grid>
              <Grid
                item
                xs={4}>
                {/* empty grid item */}
              </Grid>
            </Grid>

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
