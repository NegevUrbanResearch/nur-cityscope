import React from "react";

import {
  IconButton,
  Drawer,
  Divider,
  Grid,
  Typography,
  Button,
} from "@mui/material";

import { useNavigate } from "react-router-dom";
import { useAppData } from "../DataContext";

import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";


const MenuDrawer = ({ handleMenuClick, openMenu }) => {
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
    <Drawer
      sx={{
        width: "240px",
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: "240px",
          boxSizing: "border-box",
        },
      }}
      variant="persistent"
      anchor="left"
      open={openMenu}>
      <div>
        <IconButton onClick={handleMenuClick}>
          <ChevronLeftIcon />
        </IconButton>
      </div>
      <Divider />
      <Grid container>
        {Object.entries(indicatorConfig).map(([key, config]) => (
          <Grid
            item
            xs={12}>
            <Button
              color="inherit"
              onClick={() => handleIndicatorChange(key)}
              sx={{
                py: 2,
                px: 4,
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
              <Typography variant="h6">
                {config.name.replace("Dashboard", "").trim()}
              </Typography>
            </Button>
          </Grid>
        ))}
      </Grid>
    </Drawer>
  );
};

export default MenuDrawer;
