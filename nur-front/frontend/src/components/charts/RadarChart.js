import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import Chart from "chart.js/auto";
import { chartsDrawerWidth } from "../../style/drawersStyles";

const RadarChart = ({ data }) => {
  const chartRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    // Basic data validation
    if (
      !data ||
      !data.categories ||
      !Array.isArray(data.categories) ||
      !data.valuesSet1 ||
      !Array.isArray(data.valuesSet1) ||
      !data.valuesSet2 ||
      !Array.isArray(data.valuesSet2)
    ) {
      console.error("Invalid data for radar chart", data);
      return;
    }

    // Make sure we have a valid canvas reference
    if (!canvasRef.current) {
      console.error("Canvas reference is not available");
      return;
    }

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) {
      console.error("Unable to get 2D context from canvas");
      return;
    }

    // Keep original labels for color determination
    const originalLabels = [...data.categories];
    const formattedLabels = data.categories.map((cat) =>
      cat.replace("_d", " "),
    );

    // Function to determine the color of each label
    const getColorForLabel = (label) => {
      if (label.endsWith("_d")) return "#FFFFFF"; // White color
      if (label === "Land Uses") return "#FFFF00"; // Yellow color
      return "#00BFFF"; // Light blue color
    };

    try {
      // Cleanup existing chart
      if (chartRef.current) {
        chartRef.current.destroy();
      }

      // Create new chart
      chartRef.current = new Chart(ctx, {
        type: "radar",
        data: {
          labels: formattedLabels,
          datasets: [
            {
              label: "Base Scenario",
              data: data.valuesSet2,
              backgroundColor: "rgba(255, 0, 0, 0.2)",
              borderColor: "rgba(255, 0, 0, 1)",
              borderWidth: 2,
              pointBackgroundColor: "rgba(255, 0, 0, 1)",
              pointBorderColor: "#fff",
              pointHoverBackgroundColor: "#fff",
              pointHoverBorderColor: "rgba(255, 0, 0, 1)",
              pointRadius: 3,
            },
            {
              label: "Current Scenario",
              data: data.valuesSet1,
              backgroundColor: "rgba(59, 40, 204, 0.5)",
              borderColor: "rgba(255, 255, 255, 1)",
              borderWidth: 2,
              pointBackgroundColor: "rgba(59, 40, 204, 1)",
              pointBorderColor: "#fff",
              pointHoverBackgroundColor: "#fff",
              pointHoverBorderColor: "rgba(59, 40, 204, 1)",
              pointRadius: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          elements: {
            line: {
              borderWidth: 2,
              tension: 0.1,
            },
          },
          scales: {
            r: {
              beginAtZero: true,
              min: 0,
              max: 100,
              ticks: {
                stepSize: 20,
                backdropColor: "rgba(0, 0, 0, 0)", // Make background transparent
                color: "rgba(255, 255, 255, 0.7)",
              },
              grid: {
                color: "rgba(255, 255, 255, 0.3)",
              },
              angleLines: {
                color: "rgba(255, 255, 255, 0.3)",
              },
              pointLabels: {
                font: {
                  size: 14,
                  weight: "bold",
                },
                color: (ctx) => {
                  const index = ctx.index;
                  if (index >= originalLabels.length) {
                    return "#FFFFFF"; // Default color
                  }
                  const originalLabel = originalLabels[index];
                  return getColorForLabel(originalLabel);
                },
              },
            },
          },
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                color: "#FFFFFF",
                font: {
                  size: 12,
                },
                boxWidth: 15,
                padding: 15,
              },
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const value = context.raw;
                  return `${context.dataset.label}: ${value.toFixed(1)}`;
                },
              },
              titleFont: {
                size: 14,
              },
              bodyFont: {
                size: 13,
              },
            },
          },
        },
      });
    } catch (error) {
      console.error("Error creating radar chart:", error);
    }

    // Cleanup function
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [data]);

  // Return a container with appropriate sizing
  return (
    <div
      style={{
        position: "relative",
        width: `calc(${chartsDrawerWidth}-100px)`,
        //height: "400px",
      }}>
      <canvas ref={canvasRef}></canvas>
    </div>
  );
};

RadarChart.propTypes = {
  data: PropTypes.shape({
    categories: PropTypes.arrayOf(PropTypes.string).isRequired,
    valuesSet1: PropTypes.arrayOf(PropTypes.number).isRequired,
    valuesSet2: PropTypes.arrayOf(PropTypes.number).isRequired,
  }).isRequired,
};

export default RadarChart;
