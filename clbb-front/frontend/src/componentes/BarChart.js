import React, { useEffect } from 'react';
import Chart from 'chart.js/auto';

const StackedBarChart = ({ data }) => {
  // const xLabels = data.xLabels;
  const xLabels = ['Poblacion', 'Edificacion', 'Comodidades']

  useEffect(() => {
    const ctx = document.getElementById('stackedBarChart').getContext('2d');

    const colors = ['#0077B6', '#00B4D8', '#90E0EF'];

    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: xLabels,
        datasets: data.barras.map((barra, index) => ({
          label: barra.nombre,
          data: barra.valores,
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
              display: false, // Oculta los números del eje y
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
  }, [data, xLabels]);

  return <canvas id="stackedBarChart" width="400" height="400"></canvas>;
};

export default StackedBarChart;