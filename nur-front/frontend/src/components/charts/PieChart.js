import React, { useRef, useEffect } from "react";
import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";

ChartJS.register(ArcElement, Tooltip, Legend);

const DonutChart = ({ data }) => {
  const chartRef = useRef(null);

  // More robust data validation
  const isValidData =
    data &&
    data.labels &&
    Array.isArray(data.labels) &&
    data.datasets &&
    Array.isArray(data.datasets) &&
    data.datasets.length > 0 &&
    data.datasets[0].data &&
    Array.isArray(data.datasets[0].data);

  // Create default data if invalid
  const defaultData = {
    labels: ["No Data Available"],
    datasets: [
      {
        data: [100],
        backgroundColor: ["#95a5a6"],
        borderWidth: 1,
      },
    ],
  };

  // Use validated data or defaults
  const chartData = isValidData
    ? {
        labels: data.labels,
        datasets: [
          {
            data: data.datasets[0].data,
            backgroundColor: data.datasets[0].backgroundColor || [
              "#2ecc71",
              "#95a5a6",
            ],
            borderWidth: 1,
          },
        ],
      }
    : defaultData;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: "bottom",
        align: "center",
        labels: {
          boxWidth: 15,
          padding: 10,
          font: {
            size: 12,
          },
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.raw;
            const label = chartData.labels[context.dataIndex];
            return `${label}: ${value.toFixed(1)}%`;
          },
        },
        titleFont: {
          size: 14,
        },
        bodyFont: {
          size: 13,
        },
        padding: 10,
        displayColors: true,
        backgroundColor: "rgba(0, 0, 0, 0.8)",
      },
    },
    cutout: "60%", // Donut hole size
    animation: {
      animateRotate: true,
      animateScale: true,
    },
  };

  // Log validation errors but don't show them to users
  useEffect(() => {
    if (!isValidData && data) {
      console.error("Invalid data structure for PieChart:", data);
    }
  }, [data, isValidData]);

  return (
    <div
      style={{
        width: "100%",
        height: 320,
        marginBottom: 24,
        position: "relative",
        padding: "8px",
        overflow: "hidden",
      }}
    >
      <Doughnut data={chartData} options={chartOptions} ref={chartRef} />
      {!isValidData && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
            fontSize: "12px",
            color: "#666",
          }}
        >
          No data available
        </div>
      )}
    </div>
  );
};

export default DonutChart;
