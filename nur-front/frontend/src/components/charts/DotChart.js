import React from "react";
import {
  ResponsiveContainer,
  ScatterChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Scatter,
  Tooltip,
  Legend,
} from "recharts";

const DotChart = ({ data }) => {
  if (!data || !data.data_points) {
    return <div style={{ color: "#ffffff", textAlign: "center" }}>Loading distance perception data...</div>;
  }

  // Transform data for scatter plot
  const chartData = data.data_points.map(point => ({
    perceived_importance: point.perceived_importance,
    actual_distance: point.actual_distance,
    submission_id: point.submission_id,
  }));

  // Custom tooltip
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div style={{
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          border: "none",
          borderRadius: "4px",
          color: "#ffffff",
          padding: "8px",
        }}>
          <p style={{ margin: 0 }}>Perceived Importance: {data.perceived_importance}</p>
          <p style={{ margin: 0 }}>Actual Distance: {data.actual_distance.toFixed(2)} km</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ width: "100%", height: 300, marginBottom: 24 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart
          data={chartData}
          margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
          <XAxis
            type="number"
            dataKey="perceived_importance"
            name="Perceived Importance"
            domain={[1, 5]}
            tick={{ fill: "#ffffff", fontSize: 12 }}
            axisLine={{ stroke: "#ffffff" }}
            label={{
              value: "Perceived Importance (1-5)",
              position: "insideBottom",
              offset: -10,
              style: { textAnchor: "middle", fill: "#ffffff" },
            }}
          />
          <YAxis
            type="number"
            dataKey="actual_distance"
            name="Actual Distance"
            tick={{ fill: "#ffffff", fontSize: 12 }}
            axisLine={{ stroke: "#ffffff" }}
            label={{
              value: "Actual Distance (km)",
              angle: -90,
              position: "insideLeft",
              style: { textAnchor: "middle", fill: "#ffffff" },
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Scatter
            name="Distance Perception"
            dataKey="actual_distance"
            fill="#42E2B8"
            stroke="#42E2B8"
            strokeWidth={1}
            r={4}
          />
          <Legend 
            wrapperStyle={{ 
              paddingTop: "20px", 
              textAlign: "center",
              color: "#ffffff"
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
};

export default DotChart;