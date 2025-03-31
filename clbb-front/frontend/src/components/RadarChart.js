import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import Chart from 'chart.js/auto';

const RadarChart = ({ data }) => {
  const chartRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!data || !data.categories || !data.valuesSet1 || !data.valuesSet2) {
      console.error('Invalid data for radar chart');
      return;
    }

    const ctx = canvasRef.current.getContext('2d');

    // Keep original labels
    const originalLabels = [...data.categories];
    const formattedLabels = data.categories.map(cat => cat.replace("_d", " "));

    // Function to determine the color of each label
    const getColorForLabel = (label) => {
      if (label.endsWith('_d')) return '#FFFFFF'; // White color
      if (label === 'Land Uses') return '#FFFF00'; // Yellow color
      return '#00BFFF'; // Light blue color
    };

    if (chartRef.current) {
      chartRef.current.data.labels = formattedLabels;
      chartRef.current.data.datasets[0].data = data.valuesSet2;
      chartRef.current.data.datasets[1].data = data.valuesSet1;
      chartRef.current.update();
    } else {
      chartRef.current = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: formattedLabels,
          datasets: [
            {
              label: 'Base Scenario',
              data: [
                92.37882356694679,
                45.02786321781106,
                87.30392858205424,
                69.87082768095237,
                79.30676120759283,
                88.09045053202583,
                79.17090795757836,
                59.10384280638403,
                91.54,
                7.5,
                43.0,
                47.175760344491,
                55.0
              ],
              borderColor: 'rgba(255, 0, 0, 1)',
              borderWidth: 3,
            },
            {
              label: 'Waterfront',
              data: data.valuesSet1,
              backgroundColor: 'rgba(59, 40, 204, 0.8)',
              borderColor: 'rgba(255, 255, 255, 1)',
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          elements: {
            line: {
              borderWidth: 2,
            },
          },
          scales: {
            r: {
              beginAtZero: true,
              min: 0,
              max: 100,
              ticks: {
                stepSize: 10,
              },
              grid: {
                color: '#cccccc',
              },
              pointLabels: {
                font: {
                  size: 15,
                },
                color: (ctx) => {
                  const index = ctx.index;
                  const originalLabel = originalLabels[index]; // Use original label
                  return getColorForLabel(originalLabel);
                },
              },
            },
          },
        },
      });
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [data]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '600px' }}>
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
