import React, { useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { chartsDrawerWidth } from "../../style/drawersStyles";

const HorizontalStackedBarChart = ({ data }) => {
  const chartRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    // Data validation
    if (
      !data ||
      !data.bars ||
      !Array.isArray(data.bars) ||
      data.bars.length === 0
    ) {
      console.error(
        "Invalid data structure for HorizontalStackedBarChart",
        data,
      );
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
        (bar) => Array.isArray(bar.values) && bar.values.length > 0,
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
          scales: {
            x: {
              stacked: true,
              min: 0,
              max: 100,
              grid: {
                color: "rgba(255, 255, 255, 0.3)",
              },
            },
            y: {
              stacked: true,
              min: 0,
              grid: {
                color: "rgba(255, 255, 255, 0.3)",
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
              },
            },
            tooltip: {
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
        width: `calc(${chartsDrawerWidth}-100px)`,
        //height: "400px",
      }}>
      <canvas ref={canvasRef}></canvas>
    </div>
  );
};

export default HorizontalStackedBarChart;
