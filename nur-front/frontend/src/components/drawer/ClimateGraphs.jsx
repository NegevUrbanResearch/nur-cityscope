import React, { useEffect, useState } from "react";
import ChartCard from "./ChartCard";
import Papa from "papaparse";
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
import {
  Box,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Paper,
} from "@mui/material";
import config from "../../config";
import api from "../../api";
import globals from "../../globals";

const ClimateGraphs = () => {
  const { tempRows, humidRows, windRows, dates } = useClimateData();
  const [scenarioType, setScenarioType] = useState(
    globals.INDICATOR_STATE?.type || "utci"
  );

  // Fetch the current climate state from the backend on mount
  useEffect(() => {
    const fetchCurrentState = async () => {
      try {
        const response = await api.get(
          "/api/actions/get_current_dashboard_data/"
        );
        if (response.data && response.data.state) {
          const backendType = response.data.state.type || "utci";
          console.log(`✓ Synced climate type from backend: ${backendType}`);
          setScenarioType(backendType);

          // Update global state to match backend
          globals.INDICATOR_STATE = {
            ...globals.INDICATOR_STATE,
            ...response.data.state,
          };
        }
      } catch (error) {
        console.error("Error fetching current climate state:", error);
        // On error, keep the default "utci" state
      }
    };

    fetchCurrentState();
  }, []); // Run only once on mount

  const handleTypeChange = async (event, newType) => {
    if (newType !== null) {
      setScenarioType(newType);

      // Get current scenario (or default to 'existing')
      const currentScenario = globals.INDICATOR_STATE?.scenario || "existing";

      // Update the state on the backend
      try {
        await api.post("/api/actions/set_climate_scenario/", {
          scenario: currentScenario,
          type: newType,
        });
        console.log(`✓ Updated to ${newType} view for ${currentScenario}`);

        // Update global state
        globals.INDICATOR_STATE = {
          ...globals.INDICATOR_STATE,
          type: newType,
          scenario: currentScenario,
        };

        // Trigger a custom event to notify Dashboard of the change
        window.dispatchEvent(new CustomEvent("climateStateChanged"));
      } catch (error) {
        console.error("Error updating climate scenario type:", error);
      }
    }
  };

  return (
    <>
      <Paper sx={{ p: 2, mb: 2, backgroundColor: "rgba(0, 0, 0, 0.3)" }}>
        <Typography variant="h6" sx={{ mb: 2, color: "#fff" }}>
          Climate Visualization Type
        </Typography>

        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ mb: 1, color: "#ddd" }}>
            Map Type
          </Typography>
          <ToggleButtonGroup
            value={scenarioType}
            exclusive
            onChange={handleTypeChange}
            aria-label="scenario type"
            fullWidth
            sx={{
              "& .MuiToggleButton-root": {
                color: "#fff",
                borderColor: "rgba(255, 255, 255, 0.3)",
                "&.Mui-selected": {
                  backgroundColor: "rgba(100, 181, 246, 0.3)",
                  color: "#64B5F6",
                  borderColor: "#64B5F6",
                },
              },
            }}
          >
            <ToggleButton value="utci">UTCI Scenarios</ToggleButton>
            <ToggleButton value="plan">Plan Visualizations</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Paper>

      <ChartCard
        title="Temperature"
        data={{
          chartData: tempRows,
          seriesKeys: dates,
          xLabel: "Hour of day",
          yLabel: "Temperature (°C)",
        }}
        MemoizedChart={MetricLineChart}
      />

      <ChartCard
        title="Relative Humidity"
        data={{
          chartData: humidRows,
          seriesKeys: dates,
          xLabel: "Hour of day",
          yLabel: "Relative Humidity (%)",
        }}
        MemoizedChart={MetricLineChart}
      />

      <ChartCard
        title="Wind Speed"
        data={{
          chartData: windRows,
          seriesKeys: dates,
          xLabel: "Hour of day",
          yLabel: "Wind Speed (m/s)",
        }}
        MemoizedChart={MetricLineChart}
      />
    </>
  );
};

export default ClimateGraphs;

const useClimateData = () => {
  const url = `${process.env.PUBLIC_URL || ""}/${
    config.api.endpoints.climateData
  }`;
  const [tempRows, setTempRows] = useState([]);
  const [humidRows, setHumidRows] = useState([]);
  const [windRows, setWindRows] = useState([]);
  const [dates, setDates] = useState([]);

  useEffect(() => {
    console.log("🌡️ Loading climate data from:", url);
    Papa.parse(url, {
      download: true,
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        console.log("✓ Climate data loaded:", data.length, "rows");
        const temps = {};
        const hums = {};
        const winds = {};

        data.forEach((r) => {
          const hour = String(r.Hour);
          const date = String(r.Date);

          const temp = Number(r.dry_bulb_temperature);
          const humidity = Number(r.relative_humidity);
          const wind = Number(r.wind_speed);

          if (!temps[hour]) temps[hour] = { Hour: hour };
          if (!hums[hour]) hums[hour] = { Hour: hour };
          if (!winds[hour]) winds[hour] = { Hour: hour };

          temps[hour][date] = temp;
          hums[hour][date] = humidity;
          winds[hour][date] = wind;
        });

        const tRows = Object.values(temps);
        const hRows = Object.values(hums);
        const wRows = Object.values(winds);

        console.log("✓ Processed climate data:", {
          tempRows: tRows.length,
          humidRows: hRows.length,
          windRows: wRows.length,
        });

        setTempRows(tRows);
        setHumidRows(hRows);
        setWindRows(wRows);

        if (tRows.length > 0) {
          setDates(Object.keys(tRows[0]).filter((k) => k !== "Hour"));
        }
      },
      error: (error) => {
        console.error("Error loading climate data:", error);
      },
    });
  }, [url]);
  return { tempRows, humidRows, windRows, dates };
};

const MetricLineChart = ({ data }) => {
  if (!data?.chartData || !data?.seriesKeys) {
    return <div>Loading climate data...</div>;
  }

  const colors = ["#AED581", "#F06292", "#64B5F6", "#BA68C8", "#FFB74D"];

  return (
    <div
      style={{
        width: "100%",
        height: 320,
        marginBottom: 24,
        padding: "8px",
        overflow: "hidden",
      }}
    >
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
            dataKey="Hour"
            label={{ value: data.xLabel, position: "insideBottom", offset: -2 }}
            tick={{ fill: "#ffffff", fontSize: 12 }}
            axisLine={{ stroke: "#ffffff" }}
          />
          <YAxis
            label={{
              value: data.yLabel,
              angle: -90,
              position: "insideLeft",
              style: { textAnchor: "middle", fill: "#ffffff" },
            }}
            tick={{ fill: "#ffffff", fontSize: 12 }}
            axisLine={{ stroke: "#ffffff" }}
            width={60}
            domain={["dataMin - 5", "dataMax + 5"]}
          />
          <Tooltip
            animationDuration={0}
            contentStyle={{
              backgroundColor: "rgba(0, 0, 0, 0.8)",
              border: "none",
              borderRadius: "4px",
              color: "#ffffff",
            }}
            formatter={(value, name) => [`${value?.toFixed(2)}`, name]}
          />
          <Legend
            wrapperStyle={{ paddingTop: "20px", textAlign: "center" }}
            iconType="line"
          />
          {data.seriesKeys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              dot={false}
              strokeWidth={2}
              stroke={colors[i % colors.length]}
              connectNulls={false}
              animationDuration={0}
              activeDot={{
                r: 4,
                fill: colors[i % colors.length],
              }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
