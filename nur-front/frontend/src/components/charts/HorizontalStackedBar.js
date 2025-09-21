import React, { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

const HorizontalStackedBarChart = ({ data }) => {
  const chartRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    // Data validation - only log errors if data is provided but invalid
    if (
      data !== null &&
      data !== undefined &&
      (!data.bars || !Array.isArray(data.bars) || data.bars.length === 0)
    ) {
      console.error(
        "Invalid data structure for HorizontalStackedBarChart",
        data
      );
      return;
    }

    // Skip rendering if no data provided
    if (
      !data ||
      !data.bars ||
      !Array.isArray(data.bars) ||
      data.bars.length === 0
    ) {
      return;
    }

    const ctx = canvasRef.current.getContext("2d");

    // Clean up any existing chart
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    try {
      const levels = ["High", "Medium", "Low"];
      const colors = ["#42E2B8", "#2D82B7", "#2E3192"];

      // Validate that all bars have values array
      const validData = data.bars.every(
        (bar) => Array.isArray(bar.values) && bar.values.length > 0
      );

      if (!validData) {
        console.error("Bar data is missing values arrays", data.bars);
        return;
      }

      // Create and store the chart instance
      chartRef.current = new Chart(ctx, {
        type: "bar",
        data: {
          labels: data.bars.map((bar) => bar.name),
          datasets: data.bars[0].values.map((_, index) => ({
            label: levels[index] || `Level ${index + 1}`,
            data: data.bars.map((bar) => bar.values[index] || 0),
            backgroundColor: colors[index % colors.length],
            borderWidth: 1,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: "y",
          interaction: {
            mode: "nearest",
            intersect: false,
          },
          scales: {
            x: {
              stacked: true,
              min: 0,
              max: 100,
              grid: {
                color: "rgba(255, 255, 255, 0.2)",
                lineWidth: 1,
              },
              ticks: {
                color: "#ffffff",
                font: {
                  size: 11,
                },
                callback: function (value) {
                  return value + "%";
                },
              },
            },
            y: {
              stacked: true,
              grid: {
                color: "rgba(255, 255, 255, 0.1)",
                lineWidth: 1,
              },
              ticks: {
                color: "#ffffff",
                font: {
                  size: 11,
                },
              },
            },
          },
          plugins: {
            legend: {
              position: "bottom",
              align: "start",
              labels: {
                boxWidth: 15,
                padding: 15,
                color: "#ffffff",
                font: {
                  size: 12,
                },
              },
            },
            tooltip: {
              backgroundColor: "rgba(0, 0, 0, 0.9)",
              titleColor: "#ffffff",
              bodyColor: "#ffffff",
              borderColor: "rgba(255, 255, 255, 0.2)",
              borderWidth: 1,
              cornerRadius: 6,
              titleFont: {
                size: 13,
                weight: "bold",
              },
              bodyFont: {
                size: 12,
              },
              padding: 10,
              callbacks: {
                label: (context) => {
                  const value = context.raw || 0;
                  return `${context.dataset.label}: ${value.toFixed(1)}%`;
                },
              },
            },
          },
        },
      });
    } catch (error) {
      console.error("Error creating horizontal stacked bar chart:", error);
    }

    // Cleanup function
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [data]);

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
      <canvas ref={canvasRef}></canvas>
    </div>
  );
};

export default HorizontalStackedBarChart;
