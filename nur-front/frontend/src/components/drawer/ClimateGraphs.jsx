import React, { useEffect, useState } from "react";
import ClimateCard from "./ClimateCard";
import Papa from "papaparse";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
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
      <ClimateCard title="Temp">
        <MetricLineChart
          //title="Temp"
          data={tempRows}
          xLabel="Hour of day"
          yLabel="Temperature (C°)"
          seriesKeys={dates}
        />
      </ClimateCard>

      <ClimateCard title="Relative Humidity">
        <MetricLineChart
          //title="לחות יחסית לפי שעה (%)"
          data={humidRows}
          xLabel="Hour of day"
          yLabel="Relative Humidity (%)"
          seriesKeys={dates}
        />
      </ClimateCard>

      <ClimateCard title="Wind Speed">
        <MetricLineChart
          //title="מהירות רוח לפי שעה (m/s)"
          data={windRows}
          xLabel="Hour of day"
          yLabel="Wind speed (m/s)"
          seriesKeys={dates}
        />
      </ClimateCard>
    </>
  );
};

export default ClimateGraphs;

const useClimateData = () => {
   const url = `${process.env.PUBLIC_URL || ""}/${config.api.endpoints.climateData}`;
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

const MetricLineChart = ({ title, data, xLabel, yLabel, seriesKeys }) => {
  const colors = ["#AED581", "#F06292", "#64B5F6", "#BA68C8", "#FFB74D"]; // add more colors if needed
  return (
    <div style={{ width: "100%", height: 360, marginBottom: 24 }}>
      <ResponsiveContainer>
        <LineChart
          data={data}
          margin={{ top: 16, right: 24, bottom: 8, left: 12 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="Hour"
            label={{ value: xLabel, position: "insideBottom", offset: -2 }}
          />
          <YAxis
            label={{ value: yLabel, angle: -90, position: "insideLeft" }}
          />
          <Tooltip />
          <Legend />
          {seriesKeys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              dot={false}
              strokeWidth={2}
              stroke={colors[i]}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div style={{ paddingInline: 4, marginTop: 6, fontWeight: 600 }}>
        {title}
      </div>
    </div>
  );
};
