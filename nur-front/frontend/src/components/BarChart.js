import React, { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';

const StackedBarChart = ({ data }) => {
  const chartRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    // Data validation
    if (!data || !data.bars || !Array.isArray(data.bars)) {
      console.error('Invalid data structure for BarChart', data);
      return;
    }

    const ctx = canvasRef.current.getContext('2d');
    const xLabels = ['Population', 'Buildings', 'Amenities'];
    const colors = ['#0077B6', '#00B4D8', '#90E0EF'];

    // Clean up any existing chart
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    try {
      // Create and store the chart instance
      chartRef.current = new Chart(ctx, {
        type: 'bar',
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
          scales: {
            x: {
              stacked: true,
              grid: {
                display: false,
              },
            },
            y: {
              stacked: true,
              beginAtZero: true,
              suggestedMax: 160,
              grid: {
                display: true,
                color: 'rgba(255, 255, 255, 1)',
                drawBorder: false,
                drawTicks: false,
              },
              ticks: {
                display: false, // Hide y-axis numbers
              },
            },
          },
          plugins: {
            legend: {
              position: 'bottom',
              align: 'start',
              labels: {
                boxWidth: 15,
                padding: 15,
              },
            },
          },
        },
      });
    } catch (error) {
      console.error('Error creating bar chart:', error);
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
    <div style={{ height: '300px', width: '100%' }}>
      <canvas ref={canvasRef}></canvas>
    </div>
  );
};

export default StackedBarChart;