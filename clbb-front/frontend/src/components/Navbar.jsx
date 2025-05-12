import React from 'react';
import { AppBar, Toolbar, Typography, Button, Box} from '@mui/material';
import { Link } from 'react-router-dom';
//import config from "../config";


const Navbar = ()=> {
  return (
    <AppBar position="fixed">
    <Toolbar>
        <Box sx={{ flexGrow: 1 }}>
          <Button color="inherit" component={Link} to="/" sx={{py: 2, px: 4,textTransform: 'none'}}>  {/* should map 1 be the default page? */}
            <Typography variant="h6">
                map1
            </Typography>
          </Button>
          <Button color="inherit" component={Link} to="/map2" sx={{py: 2, px: 4,textTransform: 'none'}}>
            <Typography variant="h6">
            map3
            </Typography>
          </Button>
          <Button color="inherit" component={Link} to="/map3" sx={{py: 2, px: 4,textTransform: 'none'}}>
            <Typography variant="h6">
            map3
            </Typography>
          </Button>
        </Box>

        <Typography variant="h5">
            logo here
            {/* logo need to be smaller - in <Box> */}
            
            {/* <img
          src={config.frontend.logo.url}
          alt="CityLab Biobío"
          style={{ width: config.frontend.logo.width }}
        /> */}
        </Typography>
    </Toolbar>
  </AppBar>)
}



export default Navbar;
