import React from 'react';

const ProgressBar = ({ percentage }) => {
  let color = '';
  if (percentage <= 33) {
    color = 'red'; // color para el rango 0-33%
  } else if (percentage <= 66) {
    color = 'yellow'; // color para el rango 34-66%
  } else {
    color = 'green'; // color para el rango 67-100%
  }

  const progressStyle = {
    width: `${percentage}%`,
    backgroundColor: color,
    height: '20px',
  };

  return <div style={progressStyle}></div>;
};

const TableComponent = ({ data }) => {
  return (
    <table>
      <thead>
        <tr>
          <th>Categoría</th>
          <th>Número</th>
        </tr>
      </thead>
      <tbody>
        {data.categorias.map((categoria, index) => (
          <React.Fragment key={index}>
            <tr>
              <td>{categoria.nombre}</td>
              <td>{categoria.indicadores.indicador1}</td>
            </tr>
            <tr>
              <td colSpan="2">
                <ProgressBar percentage={categoria.indicadores.indicador1} />
              </td>
            </tr>
            <tr>
              <td>{categoria.nombre}</td>
              <td>{categoria.indicadores.indicador2}</td>
            </tr>
            <tr>
              <td colSpan="2">
                <ProgressBar percentage={categoria.indicadores.indicador2} />
              </td>
            </tr>
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
};

export default TableComponent;