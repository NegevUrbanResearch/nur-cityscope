import React, { useEffect, useState } from "react";
import Papa from "papaparse";
import ChartCard from "./ChartCard";
import RadarChart from "../charts/RadarChart";
import PieChart from "../charts/PieChart";
import StackedBarChart from "../charts/BarChart";

// Color scheme for climate charts
const CLIMATE_COLORS = {
  primary: "#42E2B8",
  secondary: "#3182CE",
  tertiary: "#E53E3E",
  quaternary: "#FFB74D",
};

const ClimateGraphs = () => {
  const { radarData, pieData, barData } = useClimateData();

  return (
    <>
      {radarData && (
        <ChartCard
          title="Climate Metrics Overview"
          data={radarData}
          MemoizedChart={RadarChart}
        />
      )}
      {pieData && (
        <ChartCard
          title="Green Space Distribution"
          data={pieData}
          MemoizedChart={PieChart}
        />
      )}
      {barData && (
        <ChartCard
          title="Climate Indicators"
          data={barData}
          MemoizedChart={StackedBarChart}
        />
      )}
    </>
  );
};

export default ClimateGraphs;

// Custom hook to load and process climate data
const useClimateData = () => {
  const [radarData, setRadarData] = useState(null);
  const [pieData, setPieData] = useState(null);
  const [barData, setBarData] = useState(null);

  useEffect(() => {
    // Load climate data from CSV
    Papa.parse(`${process.env.PUBLIC_URL}/climate/climate_data.csv`, {
      download: true,
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        console.log("✓ Climate data loaded:", data.length, "rows");

        // Process the data into different chart formats
        const processed = processClimateData(data);
        setRadarData(processed.radar);
        setPieData(processed.pie);
        setBarData(processed.bar);
      },
      error: (error) => {
        console.error("Error loading climate data:", error);
      },
    });
  }, []);

  return {
    radarData,
    pieData,
    barData,
  };
};

// Process climate data for different chart types
const processClimateData = (data) => {
  if (!data || data.length === 0) {
    return { radar: null, pie: null, bar: null };
  }

  // Example processing - adjust based on your actual CSV structure
  // Assuming CSV has columns like: metric, value, category, etc.

  // Radar chart data
  const radarMetrics = data
    .slice(0, 5)
    .map((row) => row.metric || row.name || "");
  const radarValues = data.slice(0, 5).map((row) => parseFloat(row.value) || 0);

  const radar = {
    labels:
      radarMetrics.length > 0
        ? radarMetrics
        : [
            "Temperature",
            "Humidity",
            "Air Quality",
            "Green Space",
            "Emissions",
          ],
    datasets: [
      {
        label: "Climate Metrics",
        data: radarValues.length > 0 ? radarValues : [65, 70, 75, 60, 55],
        backgroundColor: "rgba(66, 226, 184, 0.2)",
        borderColor: CLIMATE_COLORS.primary,
        pointBackgroundColor: CLIMATE_COLORS.primary,
        pointBorderColor: "#fff",
        pointHoverBackgroundColor: "#fff",
        pointHoverBorderColor: CLIMATE_COLORS.primary,
      },
    ],
  };

  // Pie chart data (example: green space vs other)
  const pie = {
    labels: ["Green Space", "Built Area", "Other"],
    datasets: [
      {
        data: [45, 40, 15],
        backgroundColor: [
          CLIMATE_COLORS.primary,
          CLIMATE_COLORS.secondary,
          CLIMATE_COLORS.tertiary,
        ],
        borderWidth: 1,
      },
    ],
  };

  // Bar chart data
  const bar = {
    bars: [
      {
        name: "Scenario 1",
        values: [65, 70, 75],
      },
      {
        name: "Scenario 2",
        values: [70, 75, 80],
      },
    ],
    labels: ["Emissions", "Green Space", "Energy"],
    colors: [CLIMATE_COLORS.primary, CLIMATE_COLORS.secondary],
  };

  return { radar, pie, bar };
};
