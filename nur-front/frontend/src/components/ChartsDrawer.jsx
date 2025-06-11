import React from "react";

import { IconButton, Drawer, Divider } from "@mui/material";

import ChevronRightIcon from "@mui/icons-material/ChevronRight";


const ChartsDrawer = ({ handleChartsClick, openCharts }) => {
  return (
    <Drawer
      sx={{
        width: '240px',
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: '240px',
        },
      }}
      variant="persistent"
      anchor="right"
      open={openCharts}>
      <div>
        <IconButton onClick={handleChartsClick}>
          <ChevronRightIcon />
        </IconButton>
      </div>
      <Divider />
      charts will be here
    </Drawer>
  );
};

export default ChartsDrawer;
