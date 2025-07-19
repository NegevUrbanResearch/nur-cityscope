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
            item
            width="100vw"
            height="76px"
            container
            direction="row"
            sx={{
              justifyContent: "space-between",
              alignItems: "center",
            }}>
            <Grid item>
              <img
                src={config.frontend.logo.url}
                alt="nur"
                style={{
                  width: "80px",
                  verticalAlign: "middle",
                  filter: "brightness(0) invert(1)",
                }}
              />
            </Grid>
            <Grid item>
              <NavMenu />
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
