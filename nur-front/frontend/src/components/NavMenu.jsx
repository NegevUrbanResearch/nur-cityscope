import React from "react";

import { Grid, Typography, Button } from "@mui/material";

import { useNavigate } from "react-router-dom";
import { useAppData } from "../DataContext";
import { chartsDrawerWidth } from "../style/drawersStyles";

const NavMenu = () => {
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
    <Grid
      container
      item
      width={`calc(100% - ${chartsDrawerWidth})`}
      justifyContent="space-around">
      {Object.entries(indicatorConfig).map(([key, config]) => (
        <Grid item  xs={12}>
          <Button
            color="inherit"
            onClick={() => handleIndicatorChange(key)}
            sx={{
              textTransform: "none",
              backgroundColor:
                currentIndicator === key
                  ? "rgba(255, 255, 255, 0.1)"
                  : "transparent",
              transition: "background-color 0.3s ease",
              "&:hover": {
                backgroundColor: "rgba(255, 255, 255, 0.15)",
              },
            }}>
            <Typography variant="h5">
              {config.name.replace("Dashboard", "").trim()}
            </Typography>
          </Button>
        </Grid>
      ))}
    </Grid>
  );
};

export default NavMenu;
