import React from "react";
import { useAppData } from "../../DataContext";

import MobilityGraphs from "./MobilityGraphs";
import ClimateGraphs from "./ClimateGraphs";

const IndicatorGraphs = () => {
  const { currentIndicator } = useAppData();

  // Route to the appropriate graphs component based on indicator type
  // Each component loads its own CSV data from public/ folder
  if (currentIndicator === "mobility") {
    return <MobilityGraphs />;
  }

  if (currentIndicator === "climate") {
    return <ClimateGraphs />;
  }

  // Default fallback for other indicators
  return (
    <div style={{ padding: "20px", color: "#ffffff" }}>
      <p>No charts available for {currentIndicator}</p>
      <p>Add CSV data files to public/{currentIndicator}/ to enable charts</p>
    </div>
  );
};

export default IndicatorGraphs;
