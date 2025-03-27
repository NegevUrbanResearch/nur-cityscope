import React from 'react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

const DonutChart = ({ data }) => {
  if (!data) {
    return <div>No data available</div>;
  }

  const chartData = {
    labels: data.labels || ['Green Space', 'Other'],
    datasets: [
      {
        data: data.datasets?.[0]?.data || [0, 0],
        backgroundColor: data.datasets?.[0]?.backgroundColor || ['#2ecc71', '#95a5a6'],
        borderWidth: 1,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        align: 'start',
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.raw;
            return `${chartData.labels[context.dataIndex]}: ${value.toFixed(2)}%`;
          },
        },
      },
    },
  };

  return (
    <div style={{ height: '300px', width: '100%' }}>
      <Doughnut data={chartData} options={chartOptions} />
    </div>
  );
};

export default DonutChart;