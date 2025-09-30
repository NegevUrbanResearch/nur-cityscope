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
import config from "../../config";

const ClimateGraphs = () => {
  const { tempRows, humidRows, windRows, dates } = useClimateData();

  return (
    <>
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
