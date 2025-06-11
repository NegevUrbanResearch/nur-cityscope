import React from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  IconButton,
  Grid,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
// import config from "../config";
import MenuDrawer from "./MenuDrawer";
import ChartsDrawer from "./ChartsDrawer";

const Navbar = () => {
  const [openMenu, setOpenMenu] = React.useState(false);
  const [openCharts, setOpenCharts] = React.useState(false);

  const handleMenuClick = () => {
    setOpenMenu(!openMenu);
  };
  const handleChartsClick = () => {
    setOpenCharts(!openCharts);
  };

  return (
    <Box>
      <AppBar
        position="fixed"
        openMenu={openMenu}
        openCharts={openCharts}>
        <Toolbar>
          <Grid
            container
            width="100%"
            justifyContent="space-between">
            <Grid item>
              <IconButton onClick={handleMenuClick}>
                <MenuIcon />
              </IconButton>
            </Grid>
            <Grid item>
              <Typography
                variant="h6"
                component="div"
                sx={{ flexGrow: 1 }}>
                title
              </Typography>
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

      <MenuDrawer
        openMenu={openMenu}
        handleMenuClick={handleMenuClick}
      />
      <ChartsDrawer
        openCharts={openCharts}
        handleChartsClick={handleChartsClick}
      />
    </Box>
  );
};

export default Navbar;

//       <Typography variant="h5">
//         <img src={config.frontend.logo.url} alt="nur" style={{ width: '160px', verticalAlign: 'middle', filter: 'brightness(0) invert(1)' }} />
//       </Typography>
