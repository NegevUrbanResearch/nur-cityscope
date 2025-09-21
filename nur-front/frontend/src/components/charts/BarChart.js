import React, { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

const StackedBarChart = ({ data }) => {
  const chartRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    // Data validation - only log errors if data is provided but invalid
    if (
      data !== null &&
      data !== undefined &&
      (!data.bars || !Array.isArray(data.bars))
    ) {
      console.error("Invalid data structure for BarChart", data);
      return;
    }

    // Skip rendering if no data provided
    if (!data || !data.bars || !Array.isArray(data.bars)) {
      return;
    }

    const ctx = canvasRef.current.getContext("2d");

    // Use labels from data if available, otherwise use defaults
    const xLabels = data.labels ||
      data.categories || ["Category 1", "Category 2", "Category 3"];
    const colors = data.colors || [
      "#42E2B8",
      "#FFB74D",
      "#E53E3E",
      "#3182CE",
      "#805AD5",
      "#38B2AC",
    ];

    // Clean up any existing chart
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    try {
      // Create and store the chart instance
      chartRef.current = new Chart(ctx, {
        type: "bar",
        data: {
          labels: xLabels,
          datasets: data.bars.map((bar, index) => ({
            label: bar.name,
            data: bar.values,
            backgroundColor: colors[index % colors.length], // Use modulo to handle if more than 3 datasets
            borderWidth: 1,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: "index",
            intersect: false,
          },
          scales: {
            x: {
              stacked: true,
              grid: {
                display: false,
              },
              ticks: {
                color: "#ffffff",
                maxRotation: 45,
                minRotation: 0,
                font: {
                  size: 11,
                },
              },
            },
            y: {
              stacked: true,
              beginAtZero: true,
              grid: {
                display: true,
                color: "rgba(255, 255, 255, 0.1)",
                drawBorder: false,
                drawTicks: false,
              },
              ticks: {
                color: "#ffffff",
                font: {
                  size: 11,
                },
                callback: function (value) {
                  return value.toLocaleString();
                },
              },
            },
          },
          plugins: {
            legend: {
              display: true,
              position: "bottom",
              align: "center",
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
                label: function (context) {
                  return `${
                    context.dataset.label
                  }: ${context.parsed.y.toLocaleString()}`;
                },
              },
            },
          },
        },
      });
    } catch (error) {
      console.error("Error creating bar chart:", error);
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

export default StackedBarChart;
