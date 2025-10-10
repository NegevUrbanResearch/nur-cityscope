import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

const SurveyBarChart = ({ data }) => {
  if (!data || !data.histogram) {
    return <div style={{ color: "#ffffff", textAlign: "center" }}>Loading walking distance data...</div>;
  }

  // Transform histogram data for bar chart
  const chartData = data.histogram.map(bin => ({
    distance: `${bin.bin_center.toFixed(2)} km`,
    count: bin.count,
    percentage: bin.percentage,
  }));

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div style={{
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          border: "none",
          borderRadius: "4px",
          color: "#ffffff",
          padding: "8px",
        }}>
          <p style={{ margin: 0 }}>Distance: {label}</p>
          <p style={{ margin: 0 }}>Count: {payload[0].value}</p>
          <p style={{ margin: 0 }}>Percentage: {payload[1].value.toFixed(1)}%</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ width: "100%", height: 300, marginBottom: 24 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.1)" />
          <XAxis
            dataKey="distance"
            tick={{ fill: "#ffffff", fontSize: 10 }}
            axisLine={{ stroke: "#ffffff" }}
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis
            tick={{ fill: "#ffffff", fontSize: 12 }}
            axisLine={{ stroke: "#ffffff" }}
            label={{
              value: "Number of Trips",
              angle: -90,
              position: "insideLeft",
              style: { textAnchor: "middle", fill: "#ffffff" },
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            name="Trip Count"
            dataKey="count"
            fill="#42E2B8"
            stroke="#42E2B8"
            strokeWidth={1}
          />
          <Legend 
            wrapperStyle={{ 
              paddingTop: "20px", 
              textAlign: "center",
              color: "#ffffff"
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default SurveyBarChart;