import React, { useEffect } from 'react';
import Chart from 'chart.js/auto';

const StackedBarChart = ({ data }) => {
  useEffect(() => {
    const ctx = document.getElementById('stackedBarChart').getContext('2d');
    const xLabels = ['Population', 'Buildings', 'Amenities'];
    const colors = ['#0077B6', '#00B4D8', '#90E0EF'];

    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: xLabels,
        datasets: data.bars.map((bar, index) => ({
          label: bar.name,
          data: bar.values,
          backgroundColor: colors[index],
          borderWidth: 1,
        })),
      },
      options: {
        scales: {
          x: {
            stacked: true,
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
        interactivity: {
          mode: 'index',
          axis: 'y',
        },
      },
    });

    return () => {
      chart.destroy();
    };
  }, [data]);

  return <canvas id="stackedBarChart" width="400" height="400"></canvas>;
};

export default StackedBarChart;