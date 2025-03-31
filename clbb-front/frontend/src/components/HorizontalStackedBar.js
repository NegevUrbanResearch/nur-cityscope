import React, { useEffect } from 'react';
import Chart from 'chart.js/auto';

const HorizontalStackedBarChart = ({ data }) => {
  useEffect(() => {
    const ctx = document.getElementById('horizontalStackedBarChart').getContext('2d');

    const levels = ['High', 'Medium', 'Low'];
    const colors = ['#42E2B8', '#2D82B7', '#2E3192'];

    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.bars.map(bar => bar.name),
        datasets: data.bars[0].values.map((value, index) => ({
          label: levels[index],
          data: data.bars.map(bar => bar.values[index]),
          backgroundColor: colors[index],
          borderWidth: 1,
        })),
      },
      options: {
        indexAxis: 'y',
        scales: {
          x: {
            stacked: true,
            min: 0,
            max: 100,
            grid: {
              color: 'rgba(255, 255, 255, 0.3)',
            },
          },
          y: {
            stacked: true,
            min: 0,
            grid: {
              color: 'rgba(255, 255, 255, 0.3)',
            },
          },
        },
      },
    });

    return () => {
      chart.destroy();
    };
  }, [data]);

  return <canvas id="horizontalStackedBarChart" width="400" height="400"></canvas>;
};

export default HorizontalStackedBarChart;