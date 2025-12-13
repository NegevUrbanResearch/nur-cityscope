import React, { useEffect, useState } from "react";
import Papa from "papaparse";
import ChartCard from "./ChartCard";
import StackedBarChart from "../charts/BarChart";
import PieChart from "../charts/PieChart";
import SurveyGraphs from "./SurveyGraphs";
import { FormControl, InputLabel, Select, MenuItem, Box } from "@mui/material";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import globals from "../../globals";

// Color scheme for mobility charts - distinct colors for better visibility
const MOBILITY_COLORS = {
  modes: {
    Walk: "#42E2B8", // Bright Green
    Bike: "#FFB74D", // Orange
    Car: "#E53E3E", // Red
    Bus: "#3182CE", // Blue
    Train: "#805AD5", // Purple
    Multimodal: "#1A202C", // Dark gray
    Other: "#718096", // Medium gray
  },
  destinations: {
    BGU: "#42E2B8", // Bright Green
    "Soroka Hospital": "#E53E3E", // Red
    "Gav Yam": "#3182CE", // Blue
  },
  distance: ["#2E3192", "#3182CE", "#00B4D8", "#42E2B8", "#FFB74D", "#E53E3E"], // Distinct blue-to-warm gradient
};

const MobilityGraphs = () => {
  const { distanceHistogramData, modeSplitData, temporalData } =
    useMobilityData();
  const [selectedDestination, setSelectedDestination] = useState("All");
  const [currentState, setCurrentState] = useState(
    globals.INDICATOR_STATE?.scenario || "current"
  );

  // Listen for state changes (event-driven, no polling)
  useEffect(() => {
    const handleStateChange = () => {
      const newState = globals.INDICATOR_STATE?.scenario || "current";
      setCurrentState(newState);
    };

    // Listen for state change events (fired by DataContext via WebSocket)
    window.addEventListener("indicatorStateChanged", handleStateChange);
    window.addEventListener("stateChanged", handleStateChange);

    // Initial sync
    handleStateChange();
    
    return () => {
      window.removeEventListener("indicatorStateChanged", handleStateChange);
      window.removeEventListener("stateChanged", handleStateChange);
    };
  }, []);

  // Get pie chart data for selected destination
  const getPieChartData = () => {
    if (!modeSplitData || selectedDestination === "All") {
      return modeSplitData?.allDestinations || null;
    }
    return modeSplitData?.[selectedDestination] || null;
  };

  const handleDestinationChange = (event) => {
    setSelectedDestination(event.target.value);
  };

  // Show survey graphs when state is "survey"
  console.log("MobilityGraphs - currentState:", currentState);
  if (currentState === "survey") {
    console.log("MobilityGraphs - Showing survey graphs");
    return <SurveyGraphs />;
  }

  return (
    <>
      <ChartCard
        title="Trips Over Time"
        data={temporalData}
        MemoizedChart={TemporalLineChart}
      />

      <ChartCard
        title="Mode Split by Destination"
        data={getPieChartData()}
        MemoizedChart={PieChart}
        customHeader={
          <Box sx={{ mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel
                id="destination-select-label"
                sx={{ color: "#ffffff" }}
              >
                Destination
              </InputLabel>
              <Select
                labelId="destination-select-label"
                value={selectedDestination}
                onChange={handleDestinationChange}
                label="Destination"
                sx={{
                  color: "#ffffff",
                  "& .MuiOutlinedInput-notchedOutline": {
                    borderColor: "#ffffff",
                  },
                  "& .MuiSvgIcon-root": {
                    color: "#ffffff",
                  },
                }}
              >
                <MenuItem value="All">All Destinations</MenuItem>
                <MenuItem value="BGU">BGU</MenuItem>
                <MenuItem value="Soroka Hospital">Soroka Hospital</MenuItem>
                <MenuItem value="Gav Yam">Gav Yam</MenuItem>
              </Select>
            </FormControl>
          </Box>
        }
      />

      <ChartCard
        title="Distance Distribution"
        data={distanceHistogramData}
        MemoizedChart={StackedBarChart}
      />
    </>
  );
};

// Temporal Line Chart Component using Recharts
const TemporalLineChart = ({ data }) => {
  if (!data?.chartData || !data?.destinations) {
    return <div>Loading temporal data...</div>;
  }

  return (
    <div style={{ width: "100%", height: 300, marginBottom: 24 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data.chartData}
          margin={{ top: 16, right: 24, bottom: 8, left: 12 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255, 255, 255, 0.1)"
          />
          <XAxis
            dataKey="hour"
            tick={{ fill: "#ffffff", fontSize: 12 }}
            axisLine={{ stroke: "#ffffff" }}
          />
          <YAxis
            tick={{ fill: "#ffffff", fontSize: 12 }}
            axisLine={{ stroke: "#ffffff" }}
            width={60}
            domain={[0, "dataMax + 2"]}
            label={{
              value: "Trips (%)",
              angle: -90,
              position: "insideLeft",
              style: { textAnchor: "middle", fill: "#ffffff" },
            }}
          />
          <Tooltip
            animationDuration={0}
            contentStyle={{
              backgroundColor: "rgba(0, 0, 0, 0.8)",
              border: "none",
              borderRadius: "4px",
              color: "#ffffff",
            }}
            formatter={(value) => [`${value.toFixed(2)}%`, ""]}
          />
          <Legend
            wrapperStyle={{ paddingTop: "20px", textAlign: "center" }}
            iconType="line"
          />
          {data.destinations.map((dest, index) => (
            <Line
              key={dest}
              type="monotone"
              dataKey={dest}
              stroke={MOBILITY_COLORS.destinations[dest] || "#42E2B8"}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              animationDuration={0}
              activeDot={{
                r: 4,
                fill: MOBILITY_COLORS.destinations[dest] || "#42E2B8",
              }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default MobilityGraphs;

// Custom hook to load and process mobility data
const useMobilityData = () => {
  const [distanceHistogramData, setDistanceHistogramData] = useState(null);
  const [modeSplitData, setModeSplitData] = useState(null);
  const [temporalData, setTemporalData] = useState(null);

  useEffect(() => {
    // Load distance histogram data
    Papa.parse(
      `${process.env.PUBLIC_URL}/mobility/frontend_distance_histogram.csv`,
      {
        download: true,
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: ({ data }) => {
          console.log("✓ Distance histogram data loaded:", data.length, "rows");
          const processedData = processDistanceHistogram(data);
          setDistanceHistogramData(processedData);
        },
        error: (error) => {
          console.error("Error loading distance histogram data:", error);
        },
      }
    );

    // Load mode split data
    Papa.parse(`${process.env.PUBLIC_URL}/mobility/frontend_mode_split.csv`, {
      download: true,
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        console.log("✓ Mode split data loaded:", data.length, "rows");
        const processedData = processModeSplit(data);
        setModeSplitData(processedData);
      },
      error: (error) => {
        console.error("Error loading mode split data:", error);
      },
    });

    // Load temporal data
    Papa.parse(`${process.env.PUBLIC_URL}/mobility/frontend_temporal.csv`, {
      download: true,
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        console.log("✓ Temporal data loaded:", data.length, "rows");
        const processedData = processTemporal(data);
        setTemporalData(processedData);
      },
      error: (error) => {
        console.error("Error loading temporal data:", error);
      },
    });
  }, []);

  return {
    distanceHistogramData,
    modeSplitData,
    temporalData,
  };
};

// Process distance histogram data for stacked bar chart with actual data ranges
const processDistanceHistogram = (data) => {
  // Create buckets based on actual data ranges, grouping logically
  const rangeMappings = {
    // All short distances grouped into 0-10km
    "0-0.5": "0-10km",
    "0.5-1": "0-10km",
    "0-1": "0-10km",
    "1-2": "0-10km",
    "2-3": "0-10km",
    ">3": "0-10km",
    "3-5": "0-10km",
    ">5": "0-10km",
    "0-10": "0-10km",

    // Car/Transit longer distances
    "10-25": "10-25km",
    "25-50": "25-50km",
    "50-75": "50-75km",
    ">75": "75km+",
  };

  const bucketData = {};
  const actualBuckets = new Set();

  data.forEach((row) => {
    const { distance_range, trips, destination } = row;
    const tripCount = parseFloat(trips) || 0;
    const bucket = rangeMappings[distance_range];

    if (bucket && tripCount > 0) {
      actualBuckets.add(bucket);

      if (!bucketData[bucket]) {
        bucketData[bucket] = {};
      }
      if (!bucketData[bucket][destination]) {
        bucketData[bucket][destination] = 0;
      }
      bucketData[bucket][destination] += tripCount;
    }
  });

  const destinations = [...new Set(data.map((row) => row.destination))];
  const distanceBuckets = Array.from(actualBuckets).sort((a, b) => {
    // Custom sort to maintain logical order
    const order = ["0-10km", "10-25km", "25-50km", "50-75km", "75km+"];
    return order.indexOf(a) - order.indexOf(b);
  });

  return {
    bars: destinations.map((dest, index) => ({
      name: dest,
      values: distanceBuckets.map((bucket) => bucketData[bucket]?.[dest] || 0),
    })),
    labels: distanceBuckets,
    colors: destinations.map(
      (dest) =>
        MOBILITY_COLORS.destinations[dest] ||
        MOBILITY_COLORS.distance[destinations.indexOf(dest)]
    ),
  };
};

// Process mode split data for pie charts by destination
const processModeSplit = (data) => {
  // Map mode names to cleaner labels
  const modeNameMap = {
    Walking: "Walk",
    "Public Transit": "Bus",
    "Shared Mobility": "Multimodal",
    Bike: "Bike",
    Car: "Car",
    Train: "Train",
  };

  // Group by destination
  const destinationData = {};
  const allModesData = {};

  data.forEach((row) => {
    const { destination, mode, percentage, trips } = row;
    const pct = parseFloat(percentage) || 0;
    const tripCount = parseFloat(trips) || 0;
    const cleanMode = modeNameMap[mode] || mode;

    if (!destinationData[destination]) {
      destinationData[destination] = {};
    }

    if (!destinationData[destination][cleanMode]) {
      destinationData[destination][cleanMode] = { percentage: 0, trips: 0 };
    }

    destinationData[destination][cleanMode].percentage += pct;
    destinationData[destination][cleanMode].trips += tripCount;

    // Aggregate for "All" option
    if (!allModesData[cleanMode]) {
      allModesData[cleanMode] = { totalTrips: 0, count: 0 };
    }
    allModesData[cleanMode].totalTrips += tripCount;
    allModesData[cleanMode].count += 1;
  });

  // Helper function to filter and process modes (only show >1%, group rest as "Other")
  const processModesData = (modesData) => {
    const modes = [];
    const percentages = [];
    let otherPercentage = 0;

    Object.entries(modesData).forEach(([mode, data]) => {
      const pct =
        data.percentage ||
        (data.totalTrips
          ? (data.totalTrips /
              Object.values(modesData).reduce(
                (sum, m) => sum + (m.totalTrips || m.trips || 0),
                0
              )) *
            100
          : 0);

      if (pct >= 1) {
        modes.push(mode);
        percentages.push(pct);
      } else {
        otherPercentage += pct;
      }
    });

    if (otherPercentage >= 1) {
      modes.push("Other");
      percentages.push(otherPercentage);
    }

    return { modes, percentages };
  };

  // Create pie chart data for each destination
  const result = {};
  Object.entries(destinationData).forEach(([dest, modesData]) => {
    const { modes, percentages } = processModesData(modesData);

    result[dest] = {
      labels: modes,
      datasets: [
        {
          data: percentages,
          backgroundColor: modes.map(
            (mode) => MOBILITY_COLORS.modes[mode] || "#718096"
          ),
          borderWidth: 1,
        },
      ],
    };
  });

  // Create "All Destinations" pie chart
  const { modes: allModes, percentages: allPercentages } =
    processModesData(allModesData);

  result.allDestinations = {
    labels: allModes,
    datasets: [
      {
        data: allPercentages,
        backgroundColor: allModes.map(
          (mode) => MOBILITY_COLORS.modes[mode] || "#718096"
        ),
        borderWidth: 1,
      },
    ],
  };

  return result;
};

// Process temporal data for line chart - three lines for destinations
const processTemporal = (data) => {
  // Group by destination and hour
  const destinationData = {};

  data.forEach((row) => {
    const { destination, hour, proportion } = row;
    const hourNum = parseInt(hour) || 0;
    const prop = parseFloat(proportion) || 0;

    if (!destinationData[destination]) {
      destinationData[destination] = new Array(24).fill(0);
    }

    destinationData[destination][hourNum] = prop * 100; // Convert to percentage
  });

  // Ensure consistent ordering: BGU, Soroka Hospital, Gav Yam
  const destinationOrder = ["BGU", "Soroka Hospital", "Gav Yam"];
  const destinations = destinationOrder.filter((dest) => destinationData[dest]);

  // Create Recharts-compatible format
  const chartData = Array.from({ length: 24 }, (_, hour) => {
    const row = { hour: `${hour}:00` };
    destinations.forEach((dest) => {
      row[dest] = destinationData[dest]?.[hour] || 0;
    });
    return row;
  });

  return {
    chartData,
    destinations,
  };
};
