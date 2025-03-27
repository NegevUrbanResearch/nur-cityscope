import React from 'react';
import { Doughnut } from 'react-chartjs-2';

const DonutChart = ({ data }) => {
  const total = data.tipos.reduce((sum, tipo) => sum + tipo.valor, 0);

  const chartData = {
    labels: data.tipos.map(tipo => tipo.nombre),
    datasets: [
      {
        data: data.tipos.map(tipo => (tipo.valor / total) * 100),
        backgroundColor: [
          'rgba(255, 99, 132, 0.2)',
          'rgba(75, 192, 192, 0.2)',
          'rgba(255, 205, 86, 0.2)',
          'rgba(54, 162, 235, 0.2)',
          'rgba(153, 102, 255, 0.2)',
          'rgba(255, 159, 64, 0.2)',
          'rgba(255, 0, 0, 0.2)',
          'rgba(0, 255, 0, 0.2)',
          'rgba(0, 0, 255, 0.2)',
          'rgba(128, 128, 128, 0.2)',
        ],
        borderColor: [
          'rgba(255, 99, 132, 1)',
          'rgba(75, 192, 192, 1)',
          'rgba(255, 205, 86, 1)',
          'rgba(54, 162, 235, 1)',
          'rgba(153, 102, 255, 1)',
          'rgba(255, 159, 64, 1)',
          'rgba(255, 0, 0, 1)',
          'rgba(0, 255, 0, 1)',
          'rgba(0, 0, 255, 1)',
          'rgba(128, 128, 128, 1)',
        ],
        borderWidth: 1,
      },
    ],
  };

  const chartOptions = {
    plugins: {
      legend: {
        display: false, // Ocultar la leyenda predeterminada
        position: 'bottom',
        labels: {
          generateLabels: (chart) => {
            const data = chart.data;
            if (data.labels.length) {
              // Divide las etiquetas en dos columnas
              const half = Math.ceil(data.labels.length / 2);
              const firstColumn = data.labels.slice(0, half);
              const secondColumn = data.labels.slice(half);

              // Ajusta la posición de la leyenda
              return chart.options.position === 'bottom' ? [...firstColumn, ...secondColumn] : data.labels;
            }

            return [];
          },
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const tipo = data.tipos[context.dataIndex];
            const porcentaje = ((tipo.valor / total) * 100).toFixed(2);
            return `${tipo.nombre}: ${porcentaje}%`;
          },
        },
      },
      datalabels: {
        color: 'white',
        formatter: (value, context) => {
          const tipo = data.tipos[context.dataIndex];
          const porcentaje = ((tipo.valor / total) * 100).toFixed(2);
          return `${porcentaje}%`;
        },
      },
    },
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
      <Doughnut data={chartData} options={chartOptions} />
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px' }}>
        <div style={{ marginRight: '20px' }}>
          {chartData.labels.slice(0, Math.ceil(chartData.labels.length / 2)).map((label, index) => (
            <div key={index} style={{ marginBottom: '10px' }}>
              <div style={{ backgroundColor: chartData.datasets[0].backgroundColor[index], width: '10px', height: '10px', display: 'inline-block', marginRight: '5px' }}></div>
              {label}
            </div>
          ))}
        </div>
        <div>
          {chartData.labels.slice(Math.ceil(chartData.labels.length / 2)).map((label, index) => (
            <div key={index} style={{ marginBottom: '10px' }}>
              <div style={{ backgroundColor: chartData.datasets[0].backgroundColor[Math.ceil(chartData.labels.length / 2) + index], width: '10px', height: '10px', display: 'inline-block', marginRight: '5px' }}></div>
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DonutChart;