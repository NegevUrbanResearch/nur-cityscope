import React from 'react';

const VolumeControl = ({ volume }) => {
  const containerStyle = {
    width: '100px', // Ajusta el ancho de la línea según tus preferencias
    height: '20px',
    position: 'relative',
    border: '1px solid #ccc', // Puedes cambiar el color del borde según tus preferencias
    borderRadius: '10px',
  };

  let color = '';
  if (volume <= 33) {
    color = 'red'; // color para el rango 0-33%
  } else if (volume <= 66) {
    color = 'yellow'; // color para el rango 34-66%
  } else {
    color = 'green'; // color para el rango 67-100%
  }

  const indicatorStyle = {
    width: '20px', // Ajusta el diámetro del indicador circular
    height: '20px',
    backgroundColor: color,
    borderRadius: '50%',
    position: 'absolute',
    left: `calc(${volume}% - 10px)`, // Posiciona el indicador en la línea de acuerdo con el volumen
    top: '50%',
    transform: 'translateY(-50%) ',
  };

  return (
    <div style={containerStyle}>
      <div style={indicatorStyle}></div>
    </div>
  );
};

const TablaSemaforo = ({ data }) => {
  return (
    <table>
      <thead>
        <tr>
          <th></th>
          {data.map((categoria, index) => (
            <th key={index}>{categoria.nombre}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td></td>
          {data.map((categoria, index) => (
            <td key={index}>
			
			<div style={{ textAlign: 'center' }}>
            <p>{categoria.indicador1}</p>
          </div>
			
			
              <VolumeControl volume={categoria.indicador1} />
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
};

export default TablaSemaforo;