import React from "react";
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
} from "recharts";

const SpiderChart = ({ data }) => {
  if (!data || !data.factors) {
    return <div style={{ color: "#ffffff", textAlign: "center" }}>Loading route factors data...</div>;
  }

  // Transform data for radar chart
  const chartData = data.factors.map(factor => ({
    factor: factor.factor,
    importance: factor.inverted_mean, // Use inverted mean (higher = more important)
    fullMark: 5, // Maximum importance value
  }));

  return (
    <div style={{ width: "100%", height: 300, marginBottom: 24 }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={chartData} margin={{ top: 20, right: 80, bottom: 20, left: 80 }}>
          <PolarGrid stroke="rgba(255, 255, 255, 0.3)" />
          <PolarAngleAxis 
            dataKey="factor" 
            tick={{ fill: "#ffffff", fontSize: 12 }}
          />
          <PolarRadiusAxis 
            angle={90} 
            domain={[0, 5]} 
            tick={{ fill: "#ffffff", fontSize: 10 }}
          />
          <Radar
            name="Importance"
            dataKey="importance"
            stroke="#42E2B8"
            fill="#42E2B8"
            fillOpacity={0.3}
            strokeWidth={2}
          />
          <Legend 
            wrapperStyle={{ 
              paddingTop: "20px", 
              textAlign: "center",
              color: "#ffffff"
            }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default SpiderChart;